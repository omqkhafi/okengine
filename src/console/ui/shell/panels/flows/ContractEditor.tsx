/**
 * Dual form ⇄ JSON contract editor (console §9.2).
 */

import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  fieldsFromSchema,
  getAtPath,
  parseJsonEditor,
  setAtPath,
  validateContract,
  valueToJsonText,
  type FieldError,
  type FormField,
} from "../../../flows/contract.ts";
import { Button, Field, Input } from "../../components/ui.tsx";

/** Props for {@link ContractEditor}. */
export interface ContractEditorProps {
  readonly schema: Record<string, unknown> | null;
  readonly value: unknown;
  readonly mode: "form" | "json";
  readonly onModeChange: (mode: "form" | "json") => void;
  readonly onChange: (value: unknown) => void;
  readonly errors: readonly FieldError[];
}

/**
 * Dual form ⇄ JSON editor synced both ways; validates locally.
 *
 * @param props - Schema, value, mode
 */
export function ContractEditor(props: ContractEditorProps) {
  const fields = fieldsFromSchema(props.schema);
  const errorByPath = new Map(props.errors.map((e) => [e.path, e.message]));

  return (
    <section className="flex flex-col gap-3" aria-label="Contract editor">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={props.mode === "form" ? "primary" : "ghost"}
          aria-pressed={props.mode === "form"}
          onClick={() => props.onModeChange("form")}
        >
          Form
        </Button>
        <Button
          type="button"
          variant={props.mode === "json" ? "primary" : "ghost"}
          aria-pressed={props.mode === "json"}
          onClick={() => props.onModeChange("json")}
        >
          JSON
        </Button>
      </div>

      {props.mode === "form" ? (
        <div className="flex flex-col gap-3">
          {fields.length === 0 ? (
            <p className="text-sm text-[var(--oke-muted)]">No input schema.</p>
          ) : (
            fields.map((field) => (
              <FormFieldControl
                key={field.path}
                field={field}
                value={props.value}
                error={errorByPath.get(field.path)}
                onChange={props.onChange}
              />
            ))
          )}
        </div>
      ) : (
        <JsonPane value={props.value} onChange={props.onChange} schema={props.schema} />
      )}
    </section>
  );
}

/**
 * Validate before invoke — returns errors under fields.
 *
 * @param schema - Input schema
 * @param value - Request body
 */
export function validateBeforeSend(schema: Record<string, unknown> | null, value: unknown) {
  return validateContract(schema, value);
}

function FormFieldControl({
  field,
  value,
  error,
  onChange,
}: {
  readonly field: FormField;
  readonly value: unknown;
  readonly error?: string;
  readonly onChange: (value: unknown) => void;
}) {
  const current = getAtPath(value, field.path);

  if (field.type === "object" && field.children) {
    return (
      <fieldset className="flex flex-col gap-2 border border-[var(--oke-line)] p-3">
        <legend className="px-1 text-xs text-[var(--oke-muted)]">{field.name}</legend>
        {field.children.map((child) => (
          <FormFieldControl key={child.path} field={child} value={value} onChange={onChange} />
        ))}
      </fieldset>
    );
  }

  if (field.type === "enum" && field.enumValues) {
    return (
      <Field label={field.name} error={error}>
        <select
          className="min-h-8 w-full border border-[var(--oke-line)] bg-transparent px-3 text-sm"
          value={String(current ?? "")}
          onChange={(e) => onChange(setAtPath(value, field.path, e.target.value))}
        >
          <option value="">Select…</option>
          {field.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (field.type === "boolean") {
    return (
      <Field label={field.name} error={error}>
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={Boolean(current)}
          onChange={(e) => onChange(setAtPath(value, field.path, e.target.checked))}
        />
      </Field>
    );
  }

  const inputType = field.type === "integer" || field.type === "number" ? "number" : "text";

  return (
    <Field label={field.name} error={error}>
      <Input
        type={inputType}
        min={field.minimum}
        max={field.maximum}
        value={current === undefined || current === null ? "" : String(current)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const next =
            field.type === "integer"
              ? raw === ""
                ? undefined
                : Number.parseInt(raw, 10)
              : field.type === "number"
                ? raw === ""
                  ? undefined
                  : Number(raw)
                : raw;
          onChange(setAtPath(value, field.path, next));
        }}
      />
    </Field>
  );
}

function JsonPane({
  value,
  onChange,
  schema,
}: {
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly schema: Record<string, unknown> | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [parseError, setParseError] = useState<string | undefined>();

  useEffect(() => {
    if (!host.current) return;
    const start = valueToJsonText(value);
    const state = EditorState.create({
      doc: start,
      extensions: [
        lineNumbers(),
        history(),
        json(),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          const parsed = parseJsonEditor(text);
          if (!parsed.ok) {
            setParseError(parsed.error);
            return;
          }
          setParseError(undefined);
          onChange(parsed.value);
        }),
        EditorView.theme({
          "&": { fontSize: "13px", minHeight: "160px" },
          ".cm-scroller": { fontFamily: "var(--oke-mono)" },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once — external value sync is intentional one-way into the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const local = schema ? validateContract(schema, value) : { ok: true, errors: [] };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={host}
        role="textbox"
        aria-label="Request JSON"
        aria-multiline="true"
        className="overflow-hidden border border-[var(--oke-line)]"
      />
      {parseError ? (
        <p role="alert" className="text-xs text-[var(--oke-danger)]">
          {parseError}
        </p>
      ) : null}
      {!local.ok ? (
        <ul className="text-xs text-[var(--oke-danger)]" aria-live="polite">
          {local.errors.map((e) => (
            <li key={`${e.path}:${e.message}`}>
              {e.path}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Dim helper for non-matching rows.
 *
 * @param props - match flag + children
 */
export function Dim({
  match,
  children,
  className,
}: {
  readonly match: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={clsx(className)}
      style={match ? undefined : { opacity: "var(--oke-dim)" }}
      data-dimmed={match ? undefined : "true"}
    >
      {children}
    </div>
  );
}
