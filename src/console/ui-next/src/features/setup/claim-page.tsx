/**
 * Setup gate — claim when open; real login when closed.
 * Claim success navigates to `?next=` when present, otherwise `/overview`.
 */

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  applySession,
  clientErrorText,
  setAccessToken,
  setupClaim,
  setupStatus,
} from "../../client.ts";
import { goAfterAuth, type AfterAuthNavigate } from "@/features/auth/auth-redirect.ts";
import { LoginForm } from "@/features/auth/login-form";
import {
  AUTH_SUBMIT_SUCCESS_MS,
  AuthCard,
  AuthCardSkeleton,
  AuthSubmitButton,
  authFieldClassName,
  authFieldGroupClassName,
  authFieldRowClassName,
  authFieldValueClassName,
  authLabelClassName,
  authSubmitState,
} from "@/components/auth-card";
import { ConsoleChrome } from "@/components/console-chrome";
import { GeneratePasswordButton } from "@/components/generate-password-button";
import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils.ts";
import { evaluateConsolePasswordRules } from "@console/password-policy";

const claimSchema = z.object({
  claimCode: z.string().min(1, "Claim code is required."),
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Enter a valid email."),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .refine((value) => evaluateConsolePasswordRules(value).every((rule) => rule.met), {
      message: "Password needs uppercase, lowercase, a number, and a special character.",
    }),
});
type ClaimValues = z.infer<typeof claimSchema>;

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

function SetupFrame({ children }: { children: ReactNode }) {
  return <ConsoleChrome>{children}</ConsoleChrome>;
}

/**
 * Setup / claim / login gate for ui-next.
 */
export function ClaimPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const [formError, setFormError] = useState<string | null>(null);
  const [passwordRevealNonce, setPasswordRevealNonce] = useState(0);

  const status = useQuery({
    queryKey: ["console.setup.status"],
    queryFn: async () => {
      const res = await setupStatus();
      if (res.error) throw new Error(clientErrorText(res.error));
      if (!res.data) throw new Error("Empty setup status");
      return res.data;
    },
    retry: 2,
  });

  useEffect(() => {
    if (status.data?.claimRequired) {
      setAccessToken(null);
    }
  }, [status.data?.claimRequired]);

  const claim = useMutation({
    mutationFn: async (values: ClaimValues) => {
      const res = await setupClaim(values);
      if (res.error) throw new Error(clientErrorText(res.error));
      if (!res.data) throw new Error("Empty claim response");
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
      claimCode: "",
      name: "",
      email: "",
      password: "",
    } satisfies ClaimValues,
    validators: {
      onSubmit: claimSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      await claim.mutateAsync(value);
    },
  });

  if (status.isLoading) {
    return (
      <SetupFrame>
        <AuthCardSkeleton />
      </SetupFrame>
    );
  }

  if (status.isError) {
    return (
      <SetupFrame>
        <AuthCard
          title="Console unreachable"
          status={{ label: "Offline", tone: "alert" }}
          description="Could not reach the setup API."
        >
          <p className="px-5 pb-6 text-sm text-muted-foreground" role="alert">
            {status.error instanceof Error
              ? status.error.message
              : "Is the Console kernel running on :6533?"}
          </p>
        </AuthCard>
      </SetupFrame>
    );
  }

  if (status.data?.setupClosed) {
    return (
      <SetupFrame>
        <LoginForm />
      </SetupFrame>
    );
  }

  const formErrorId = "claim-form-error";

  return (
    <SetupFrame>
      <AuthCard
        title="First admin"
        status={{ label: "Setup open", tone: "open" }}
        description="Enter the claim code from the `oke dev` board, or run `oke console claim-code`. This wizard closes permanently after the first operator."
        footer={
          <AuthSubmitButton
            type="submit"
            form="claim-form"
            state={authSubmitState({
              pending: claim.isPending,
              success: claim.isSuccess,
              error: claim.isError || formError !== null,
            })}
            loadingText="Creating"
            successText="Created"
            errorText="Try again"
          >
            Create admin account
          </AuthSubmitButton>
        }
      >
        {({ titleId, descriptionId }) => (
          <form
            id="claim-form"
            className="flex flex-col"
            autoComplete="off"
            noValidate
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            aria-busy={claim.isPending || undefined}
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <FieldGroup
              className={authFieldGroupClassName}
              role="group"
              aria-label="First admin details"
            >
              <form.Field
                name="claimCode"
                children={(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const errorId = `${field.name}-error`;
                  return (
                    <Field data-invalid={isInvalid || undefined} className={authFieldRowClassName}>
                      <FieldLabel htmlFor={field.name} className={authLabelClassName}>
                        Claim code
                        <RequiredMark />
                      </FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="text"
                        inputMode="text"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="Claim code"
                        aria-invalid={isInvalid}
                        aria-required
                        aria-describedby={describedBy(isInvalid && errorId)}
                        required
                        className={authFieldClassName}
                      />
                      {isInvalid ? (
                        <FieldError
                          id={errorId}
                          className={authFieldValueClassName}
                          errors={field.state.meta.errors}
                        />
                      ) : null}
                    </Field>
                  );
                }}
              />

              <form.Field
                name="name"
                children={(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const errorId = `${field.name}-error`;
                  return (
                    <Field data-invalid={isInvalid || undefined} className={authFieldRowClassName}>
                      <FieldLabel htmlFor={field.name} className={authLabelClassName}>
                        Name
                        <RequiredMark />
                      </FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="text"
                        autoComplete="name"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Name"
                        aria-invalid={isInvalid}
                        aria-required
                        aria-describedby={describedBy(isInvalid && errorId)}
                        required
                        className={authFieldClassName}
                      />
                      {isInvalid ? (
                        <FieldError
                          id={errorId}
                          className={authFieldValueClassName}
                          errors={field.state.meta.errors}
                        />
                      ) : null}
                    </Field>
                  );
                }}
              />

              <form.Field
                name="email"
                children={(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const errorId = `${field.name}-error`;
                  return (
                    <Field data-invalid={isInvalid || undefined} className={authFieldRowClassName}>
                      <FieldLabel htmlFor={field.name} className={authLabelClassName}>
                        Email
                        <RequiredMark />
                      </FieldLabel>
                      <Input
                        id={field.name}
                        name={field.name}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="Email"
                        aria-invalid={isInvalid}
                        aria-required
                        aria-describedby={describedBy(isInvalid && errorId)}
                        required
                        className={authFieldClassName}
                      />
                      {isInvalid ? (
                        <FieldError
                          id={errorId}
                          className={authFieldValueClassName}
                          errors={field.state.meta.errors}
                        />
                      ) : null}
                    </Field>
                  );
                }}
              />

              <form.Field
                name="password"
                children={(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const strengthId = `${field.name}-strength`;
                  const errorId = `${field.name}-error`;
                  return (
                    <Field
                      data-invalid={isInvalid || undefined}
                      className={cn(authFieldRowClassName, "items-start")}
                    >
                      <div className="flex flex-col items-start gap-1.5 pt-1.5">
                        <FieldLabel htmlFor={field.name} className={authLabelClassName}>
                          Password
                          <RequiredMark />
                        </FieldLabel>
                        <GeneratePasswordButton
                          disabled={claim.isPending}
                          onGenerate={(password) => {
                            field.handleChange(password);
                            setPasswordRevealNonce((n) => n + 1);
                          }}
                        />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <PasswordInput
                          id={field.name}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          revealNonce={passwordRevealNonce}
                          minLength={12}
                          autoComplete="new-password"
                          placeholder="Password"
                          aria-invalid={isInvalid}
                          aria-required
                          aria-describedby={describedBy(strengthId, isInvalid && errorId)}
                          required
                          className={authFieldClassName}
                        />
                        <PasswordStrength id={strengthId} password={field.state.value} />
                        {isInvalid ? (
                          <FieldError id={errorId} errors={field.state.meta.errors} />
                        ) : null}
                      </div>
                    </Field>
                  );
                }}
              />
            </FieldGroup>

            {formError ? (
              <p
                id={formErrorId}
                className="px-5 py-3.5 text-sm text-destructive"
                role="alert"
                aria-live="assertive"
              >
                {formError}
              </p>
            ) : null}
          </form>
        )}
      </AuthCard>
    </SetupFrame>
  );
}
