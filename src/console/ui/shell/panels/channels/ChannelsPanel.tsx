/**
 * Channels panel — inbox (dev) / deliverability (prod) (console §9.9).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  filterTemplates,
  formatFallbackLine,
  formatLocaleChainDisplay,
  isConsequenceEmphasized,
  openTemplate,
  sendTestConfirmation,
  serializeChannelsSearch,
  sortByConsequence,
  STATE_LABEL,
  validateTypedConfirm,
  VERDICT_LABEL,
  type ChannelsListResponse,
  type ChannelsSearch,
  type ChannelPreview,
  type EmailAuthView,
} from "../../../channels/index.ts";
import { consoleCalls } from "../../client.ts";
import { Button } from "../../components/ui.tsx";

/**
 * Channels panel.
 */
export function ChannelsPanel() {
  const search = useSearch({ from: "/channels" }) as ChannelsSearch;
  const navigate = useNavigate({ from: "/channels" });
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [testTo, setTestTo] = useState("test@example.com");
  const [previewLocale, setPreviewLocale] = useState(search.locale ?? "");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const setSearch = (next: ChannelsSearch) => {
    void navigate({
      search: serializeChannelsSearch(next) as never,
      replace: true,
    });
  };

  const listQuery = useQuery({
    queryKey: ["console.channel.list"],
    queryFn: async () => {
      const res = await consoleCalls.channelsList();
      if (res.error) throw new Error(res.error.code);
      return res.data as ChannelsListResponse;
    },
    refetchInterval: 10_000,
  });

  const list = listQuery.data;
  const templates = useMemo(
    () => filterTemplates(list?.templates ?? [], search.q ?? ""),
    [list?.templates, search.q],
  );
  const open =
    templates.find((t) => t.name === search.template) ??
    list?.templates.find((t) => t.name === search.template);
  const outcomes = sortByConsequence(list?.outcomes ?? []);
  const production = list?.production ?? true;
  const sendConfirm = sendTestConfirmation({ production });

  const previewQuery = useQuery({
    queryKey: ["console.channel.preview", open?.name, previewLocale || search.locale],
    enabled: !!open,
    queryFn: async () => {
      if (!open) return null;
      const res = await consoleCalls.channelPreview({
        template: open.name,
        locale: previewLocale || search.locale || open.locales[0],
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as ChannelPreview;
    },
  });

  const authQuery = useQuery({
    queryKey: ["console.channel.verifyAuth", open?.from],
    enabled: !!open?.from,
    queryFn: async () => {
      if (!open?.from) return null;
      const res = await consoleCalls.channelVerifyAuth({ from: open.from });
      if (res.error) throw new Error(res.error.code);
      return res.data as EmailAuthView;
    },
  });

  useEffect(() => {
    setTyped("");
    setReason("");
    setStatusMsg(null);
    if (open?.locales[0] && !previewLocale) {
      setPreviewLocale(open.locales[0]);
    }
  }, [open?.name]);

  const sendTest = useMutation({
    mutationFn: async () => {
      if (!open) throw new Error("No template selected");
      if (sendConfirm.kind === "typed") {
        const errors = validateTypedConfirm({
          typed,
          reason,
          phrase: sendConfirm.phrase,
        });
        if (errors) {
          throw new Error(errors.typed ?? errors.reason ?? "Confirm required");
        }
      }
      const res = await consoleCalls.channelSendTest({
        template: open.name,
        to: testTo,
        locale: previewLocale || open.locales[0],
        confirmation: sendConfirm.kind === "typed" ? sendConfirm.phrase : undefined,
        reason: sendConfirm.kind === "typed" ? reason : undefined,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data!;
    },
    onSuccess: (data) => {
      setStatusMsg(
        data.ok
          ? `Sent · ${data.messageId}${data.chain ? ` · ${data.chain}` : ""}`
          : `Failed · ${data.status}`,
      );
      void qc.invalidateQueries({ queryKey: ["console.channel.list"] });
      setTyped("");
      setReason("");
    },
    onError: (err) => {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    },
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-[var(--oke-line)] px-4 py-3">
        <h1 className="text-lg text-[var(--oke-fg)]">Channels</h1>
        <p className="mt-1 text-sm text-[var(--oke-muted)]">
          {list?.face === "inbox"
            ? "Dev inbox — all media land here instead of sending"
            : "Deliverability — seven states of did not arrive"}
        </p>
        <label className="mt-3 block text-sm text-[var(--oke-muted)]">
          Filter templates
          <input
            aria-label="Filter templates"
            className="mt-1 block w-full max-w-md border border-[var(--oke-line)] bg-transparent px-2 py-1 text-[var(--oke-fg)]"
            value={search.q ?? ""}
            onChange={(e) => setSearch({ ...search, q: e.target.value })}
          />
        </label>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section
          aria-label="Templates"
          className="w-64 shrink-0 overflow-y-auto border-r border-[var(--oke-line)] p-3"
        >
          <h2 className="mb-2 text-xs tracking-wide text-[var(--oke-muted)]">Templates</h2>
          {listQuery.isLoading ? (
            <p className="text-sm text-[var(--oke-muted)]">Loading…</p>
          ) : (
            <ul className="space-y-1">
              {templates.map((t) => (
                <li key={t.name}>
                  <button
                    type="button"
                    aria-pressed={t.name === search.template}
                    className={clsx(
                      "flex min-h-8 w-full items-center justify-between px-2 text-left text-sm",
                      t.name === search.template
                        ? "bg-[var(--oke-line)] text-[var(--oke-fg)]"
                        : "text-[var(--oke-muted)]",
                    )}
                    onClick={() => setSearch(openTemplate(search, t.name))}
                  >
                    <span>{t.name}</span>
                    <span className="font-mono text-xs">{t.medium}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <main id="channels-main" className="min-w-0 flex-1 overflow-y-auto p-4">
          {list?.face === "inbox" ? (
            <section aria-label="Inbox" className="mb-8">
              <h2 className="text-base text-[var(--oke-fg)]">Inbox</h2>
              <ul className="mt-3 space-y-2">
                {(list.inbox ?? []).map((e) => (
                  <li key={e.id} className="border-b border-[var(--oke-line)] pb-2 text-sm">
                    <div className="flex gap-2 text-[var(--oke-muted)]">
                      <span>{e.medium}</span>
                      <span>{e.toMasked}</span>
                      {e.template ? <span>{e.template}</span> : null}
                    </div>
                    <p className="mt-1 text-[var(--oke-fg)]">{e.subject ?? e.text ?? "(empty)"}</p>
                  </li>
                ))}
                {(list.inbox ?? []).length === 0 ? (
                  <li className="text-sm text-[var(--oke-muted)]">No messages yet</li>
                ) : null}
              </ul>
            </section>
          ) : null}

          <section aria-label="Did not arrive" className="mb-8">
            <h2 className="text-base text-[var(--oke-fg)]">Did not arrive</h2>
            <table className="mt-3 w-full text-left text-sm">
              <caption className="sr-only">Seven-state taxonomy with verdicts</caption>
              <thead>
                <tr className="text-[var(--oke-muted)]">
                  <th scope="col" className="py-1 font-normal">
                    State
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Count
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Verdict
                  </th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((row) => (
                  <tr
                    key={row.state}
                    className={clsx(
                      "border-t border-[var(--oke-line)]",
                      isConsequenceEmphasized(row) && "text-[var(--oke-fg)]",
                    )}
                  >
                    <th scope="row" className="py-2 font-normal">
                      {STATE_LABEL[row.state]}
                    </th>
                    <td className="py-2">{row.count}</td>
                    <td className="py-2">{VERDICT_LABEL[row.verdict]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-label="Fallback chains" className="mb-8">
            <h2 className="text-base text-[var(--oke-fg)]">Fallback</h2>
            <p className="mt-2 text-sm text-[var(--oke-muted)]" role="status">
              {list ? formatFallbackLine(list.fallback) : "—"}
            </p>
          </section>

          {open ? (
            <section aria-label="Template detail" className="mb-8">
              <h2 className="text-base text-[var(--oke-fg)]">{open.name}</h2>
              <p className="mt-1 text-sm text-[var(--oke-muted)]">
                From {open.from ?? "unset"} · Locales {open.locales.join(", ") || "none"}
              </p>

              {open.from ? (
                <section aria-label="Email authentication" className="mt-4">
                  <h3 className="text-sm text-[var(--oke-fg)]">SPF / DKIM / DMARC</h3>
                  {authQuery.data ? (
                    <ul className="mt-2 space-y-1 text-sm text-[var(--oke-muted)]">
                      <li>SPF: {authQuery.data.spf}</li>
                      <li>DKIM: {authQuery.data.dkim}</li>
                      <li>DMARC: {authQuery.data.dmarc}</li>
                      <li className="font-mono text-xs">{authQuery.data.domain}</li>
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--oke-muted)]">Checking…</p>
                  )}
                </section>
              ) : null}

              <section aria-label="Locale preview" className="mt-4">
                <h3 className="text-sm text-[var(--oke-fg)]">Preview</h3>
                <label className="mt-2 block text-sm text-[var(--oke-muted)]">
                  Locale
                  <select
                    aria-label="Preview locale"
                    className="mt-1 block border border-[var(--oke-line)] bg-transparent px-2 py-1"
                    value={previewLocale || open.locales[0] || "en"}
                    onChange={(e) => setPreviewLocale(e.target.value)}
                  >
                    {(open.locales.length > 0 ? open.locales : ["en"]).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                {previewQuery.data ? (
                  <>
                    <p className="mt-2 text-xs text-[var(--oke-muted)]">
                      Locale chain: {formatLocaleChainDisplay(previewQuery.data.localeChain)}
                    </p>
                    <div
                      className="mt-2 max-w-prose border border-[var(--oke-line)] p-3 text-sm text-[var(--oke-fg)]"
                      dir={previewQuery.data.dir}
                      lang={previewQuery.data.locale}
                    >
                      {previewQuery.data.subject ? (
                        <p className="mb-2 font-medium">{previewQuery.data.subject}</p>
                      ) : null}
                      <p>{previewQuery.data.text ?? previewQuery.data.html}</p>
                    </div>
                  </>
                ) : null}
              </section>

              <section aria-label="Send test" className="mt-6">
                <h3 className="text-sm text-[var(--oke-fg)]">Send test</h3>
                <p className="mt-1 text-sm text-[var(--oke-muted)]" role="status">
                  Real send to a designated recipient — not a dry run
                </p>
                <label className="mt-3 block text-sm text-[var(--oke-muted)]">
                  Recipient
                  <input
                    aria-label="Test recipient"
                    className="mt-1 block w-full max-w-md border border-[var(--oke-line)] bg-transparent px-2 py-1 text-[var(--oke-fg)]"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                  />
                </label>
                {sendConfirm.kind === "typed" ? (
                  <>
                    <label className="mt-3 block text-sm text-[var(--oke-muted)]">
                      Type {sendConfirm.phrase} to confirm
                      <input
                        aria-label={`Type ${sendConfirm.phrase} to confirm`}
                        className="mt-1 block w-full max-w-md border border-[var(--oke-line)] bg-transparent px-2 py-1 text-[var(--oke-fg)]"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="mt-3 block text-sm text-[var(--oke-muted)]">
                      Reason
                      <input
                        aria-label="Reason for send test"
                        className="mt-1 block w-full max-w-md border border-[var(--oke-line)] bg-transparent px-2 py-1 text-[var(--oke-fg)]"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                  </>
                ) : null}
                <div className="mt-3">
                  <Button
                    type="button"
                    onClick={() => sendTest.mutate()}
                    disabled={sendTest.isPending || !testTo.trim()}
                  >
                    Send test
                  </Button>
                </div>
                {statusMsg ? (
                  <p className="mt-2 text-sm text-[var(--oke-muted)]" role="status">
                    {statusMsg}
                  </p>
                ) : null}
              </section>
            </section>
          ) : (
            <p className="text-sm text-[var(--oke-muted)]">
              Select a template to preview and send a test.
            </p>
          )}

          <section aria-label="Suppression list" className="mb-8">
            <h2 className="text-base text-[var(--oke-fg)]">Suppression</h2>
            <ul className="mt-3 space-y-1 text-sm text-[var(--oke-muted)]">
              {(list?.suppression ?? []).map((s) => (
                <li key={`${s.subjectMasked}-${s.reason}-${s.at}`}>
                  {s.subjectMasked} · {s.reason} · {s.medium}
                </li>
              ))}
              {(list?.suppression ?? []).length === 0 ? <li>Empty</li> : null}
            </ul>
          </section>

          <section aria-label="Recent receipts">
            <h2 className="text-base text-[var(--oke-fg)]">Receipts</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(list?.receipts ?? []).map((r) => (
                <li
                  key={r.id}
                  className="border-b border-[var(--oke-line)] pb-2 text-[var(--oke-muted)]"
                >
                  <span className="text-[var(--oke-fg)]">{r.template}</span>
                  {" → "}
                  {r.toMasked} · {r.status}
                  {r.chain ? ` · ${r.chain}` : ""}
                  {r.localeChain.length > 0 ? (
                    <span className="block text-xs">
                      Locale: {formatLocaleChainDisplay(r.localeChain)}
                    </span>
                  ) : null}
                </li>
              ))}
              {(list?.receipts ?? []).length === 0 ? <li>No receipts yet</li> : null}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
