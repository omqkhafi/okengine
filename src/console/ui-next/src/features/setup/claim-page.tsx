/**
 * Setup gate — claim when open; real login when closed.
 * Claim success navigates to the authenticated shell (`/overview`).
 */

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { z } from "zod";
import {
  applySession,
  clientErrorText,
  setAccessToken,
  setupClaim,
  setupStatus,
} from "../../client.ts";
import { LoginForm } from "@/features/auth/login-form";
import { AuthCard, AuthCardSkeleton } from "@/components/auth-card";
import { ConsoleChrome } from "@/components/console-chrome";
import { PasswordInput } from "@/components/password-input";
import { PasswordStrength } from "@/components/password-strength";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

function SetupFrame({ children }: { children: ReactNode }) {
  return <ConsoleChrome>{children}</ConsoleChrome>;
}

/**
 * Setup / claim / login gate for ui-next.
 */
export function ClaimPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

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
      void navigate({ to: "/overview" });
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
        <AuthCard title="Console unreachable" description="Could not reach the setup API.">
          <p className="text-sm text-muted-foreground" role="alert">
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
        description="Enter the claim code from the Console boot log, or run `oke console claim-code`. This wizard closes permanently after the first operator."
        footer={
          <Button
            type="submit"
            form="claim-form"
            size="lg"
            disabled={claim.isPending}
            aria-disabled={claim.isPending || undefined}
            className="h-11 w-full rounded-xl"
          >
            {claim.isPending ? "Creating admin account…" : "Create admin account"}
          </Button>
        }
      >
        {({ titleId, descriptionId }) => (
          <form
            id="claim-form"
            className="flex flex-col gap-5"
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
            <FieldGroup className="gap-4" role="group" aria-label="First admin details">
              <form.Field
                name="claimCode"
                children={(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const errorId = `${field.name}-error`;
                  return (
                    <Field data-invalid={isInvalid || undefined}>
                      <FieldLabel htmlFor={field.name}>
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
                name="name"
                children={(field) => {
                  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  const errorId = `${field.name}-error`;
                  return (
                    <Field data-invalid={isInvalid || undefined}>
                      <FieldLabel htmlFor={field.name}>
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
                        autoComplete="email"
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
                  const strengthId = `${field.name}-strength`;
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
                        minLength={12}
                        autoComplete="new-password"
                        placeholder="Password"
                        aria-invalid={isInvalid}
                        aria-required
                        aria-describedby={describedBy(strengthId, isInvalid && errorId)}
                        required
                        className={inputClassName}
                      />
                      <PasswordStrength id={strengthId} password={field.state.value} />
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
    </SetupFrame>
  );
}
