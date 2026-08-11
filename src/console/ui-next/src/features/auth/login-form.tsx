/**
 * Operator login — real POST /console/session/login.
 * Shown when setup is closed; success navigates to the authenticated shell.
 */

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { applySession, clientErrorText, sessionLogin } from "../../client.ts";
import { AuthCard } from "@/components/auth-card";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});
type LoginValues = z.infer<typeof loginSchema>;

const inputClassName = "h-10 rounded-xl bg-background px-3 md:text-sm";

/**
 * Join id tokens for aria-describedby (skips empty).
 *
 * @param ids - Candidate element ids
 */
function describedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const value = ids.filter((id): id is string => typeof id === "string" && id.length > 0).join(" ");
  return value.length > 0 ? value : undefined;
}

function RequiredMark() {
  return (
    <>
      <span className="text-destructive" aria-hidden>
        {" "}
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

/**
 * Email + password login card for a closed Console setup.
 */
export function LoginForm() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: async (values: LoginValues) => {
      const res = await sessionLogin(values);
      if (res.error) throw new Error(clientErrorText(res.error));
      if (!res.data) throw new Error("Empty login response");
      return res.data;
    },
    onSuccess: (data) => {
      applySession(data);
      setFormError(null);
      void qc.invalidateQueries({ queryKey: ["console.setup.status"] });
      void navigate({ to: "/flows" });
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const form = useForm({
    defaultValues: {
      email: __OKE_DEV_OPERATOR__?.email ?? "",
      password: __OKE_DEV_OPERATOR__?.password ?? "",
    } satisfies LoginValues,
    validators: {
      onSubmit: loginSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      await login.mutateAsync(value);
    },
  });

  const formErrorId = "login-form-error";

  return (
    <AuthCard
      title="Sign in"
      description="Setup is closed. Sign in with an existing operator account."
      footer={
        <Button
          type="submit"
          form="login-form"
          size="lg"
          disabled={login.isPending}
          aria-disabled={login.isPending || undefined}
          className="h-11 w-full rounded-xl"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      }
    >
      {({ titleId, descriptionId }) => (
        <form
          id="login-form"
          className="flex flex-col gap-5"
          autoComplete="on"
          noValidate
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={login.isPending || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup className="gap-4" role="group" aria-label="Operator credentials">
            <form.Field
              name="email"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = `${field.name}-error`;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>
                      Email
                      <RequiredMark />
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="Email"
                      aria-invalid={isInvalid}
                      aria-required
                      aria-describedby={describedBy(isInvalid && errorId)}
                      required
                      className={inputClassName}
                    />
                    {isInvalid ? (
                      <FieldError id={errorId} errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                );
              }}
            />

            <form.Field
              name="password"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = `${field.name}-error`;
                return (
                  <Field data-invalid={isInvalid || undefined}>
                    <FieldLabel htmlFor={field.name}>
                      Password
                      <RequiredMark />
                    </FieldLabel>
                    <PasswordInput
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      autoComplete="current-password"
                      placeholder="Password"
                      aria-invalid={isInvalid}
                      aria-required
                      aria-describedby={describedBy(isInvalid && errorId)}
                      required
                      className={inputClassName}
                    />
                    {isInvalid ? (
                      <FieldError id={errorId} errors={field.state.meta.errors} />
                    ) : null}
                  </Field>
                );
              }}
            />
          </FieldGroup>

          {formError ? (
            <p
              id={formErrorId}
              className="text-sm text-destructive"
              role="alert"
              aria-live="assertive"
            >
              {formError}
            </p>
          ) : null}
        </form>
      )}
    </AuthCard>
  );
}
