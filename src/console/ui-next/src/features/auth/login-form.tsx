/**
 * Operator login — real POST /console/session/login.
 * Shown when setup is closed; success restores `?next=` or `/flows`.
 */

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { applySession, clientErrorText, sessionLogin } from "../../client.ts";
import { goAfterAuth, type AfterAuthNavigate } from "./auth-redirect.ts";
import {
  AUTH_SUBMIT_SUCCESS_MS,
  AuthCard,
  authSubmitClassName,
  authSubmitState,
} from "@/components/auth-card";
import { StatefulButton } from "@/components/motion/button/index.ts";
import { PasswordInput } from "@/components/password-input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Password is required."),
});
type LoginValues = z.infer<typeof loginSchema>;

const inputClassName =
  "h-10 rounded-xl border-foreground/10 bg-muted/50 px-3 text-base md:text-sm dark:bg-background/50";

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
  const search = useSearch({ from: "/" });
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
      window.setTimeout(() => {
        goAfterAuth(navigate as AfterAuthNavigate, search.next);
      }, AUTH_SUBMIT_SUCCESS_MS);
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
      status={{ label: "Setup closed" }}
      description="Sign in with an existing operator account."
      footer={
        <StatefulButton
          type="submit"
          form="login-form"
          size="lg"
          pressScale={0.98}
          state={authSubmitState({
            pending: login.isPending,
            success: login.isSuccess,
            error: login.isError || formError !== null,
          })}
          loadingText="Signing in"
          successText="Signed in"
          errorText="Try again"
          className={authSubmitClassName}
        >
          Sign in
        </StatefulButton>
      }
    >
      {({ titleId, descriptionId }) => (
        <form
          id="login-form"
          className="flex flex-col gap-6"
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
          <FieldGroup className="gap-5" role="group" aria-label="Operator credentials">
            <form.Field
              name="email"
              children={(field) => {
                const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                const errorId = `${field.name}-error`;
                return (
                  <Field data-invalid={isInvalid || undefined} className="gap-2.5">
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
                  <Field data-invalid={isInvalid || undefined} className="gap-2.5">
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
