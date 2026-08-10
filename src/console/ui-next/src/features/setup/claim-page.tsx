/**
 * First-admin claim page — real GET/POST /console/setup/* wiring.
 * Phase 1: claim + closed + success only (no login, no shell).
 */

import { SquareLock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  clientErrorText,
  setAccessToken,
  setupClaim,
  setupStatus,
  type SetupClaimResult,
} from "../../client.ts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const claimSchema = z.object({
  claimCode: z.string().min(1, "Claim code is required."),
  name: z.string().min(1, "Name is required."),
  email: z.string().email("Enter a valid email."),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
      message: "Password needs a letter and a number.",
    }),
});

type ClaimValues = z.infer<typeof claimSchema>;

/**
 * Setup / claim gate for ui-next Phase 1.
 */
export function ClaimPage() {
  const qc = useQueryClient();
  const [claimed, setClaimed] = useState<SetupClaimResult | null>(null);
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
      setAccessToken(data.accessToken);
      setClaimed(data);
      setFormError(null);
      void qc.invalidateQueries({ queryKey: ["console.setup.status"] });
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
      <main className="grid min-h-dvh place-items-center text-muted-foreground">
        Checking setup…
      </main>
    );
  }

  if (status.isError) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="flex max-w-md flex-col gap-2">
          <p className="text-foreground">Console unreachable</p>
          <p className="text-sm text-muted-foreground">
            {status.error instanceof Error
              ? status.error.message
              : "Could not load setup status. Is the Console kernel running on :6533?"}
          </p>
        </div>
      </main>
    );
  }

  if (claimed) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">First admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Console</h1>
        <p role="status" className="text-muted-foreground">
          First operator created. Signed in as {claimed.name} ({claimed.email}).
        </p>
      </main>
    );
  }

  if (status.data?.setupClosed) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">First admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Console</h1>
        <p className="text-muted-foreground">
          Setup is closed. Sign in with an existing operator account.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <HugeiconsIcon
          icon={SquareLock01Icon}
          size={28}
          color="currentColor"
          strokeWidth={1.5}
          className="text-foreground"
          aria-hidden
        />
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">First admin</p>
        <h1 className="text-3xl font-semibold tracking-tight">Console</h1>
        <p className="text-muted-foreground">
          Enter the claim code printed once to the boot log. This wizard closes permanently after
          the first operator.
        </p>
      </header>

      <form
        className="flex flex-col gap-4"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.Field
            name="claimCode"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid || undefined}>
                  <FieldLabel htmlFor={field.name}>Claim code</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    autoComplete="off"
                    aria-invalid={isInvalid}
                    required
                  />
                  {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                </Field>
              );
            }}
          />

          <form.Field
            name="name"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid || undefined}>
                  <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    required
                  />
                  {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                </Field>
              );
            }}
          />

          <form.Field
            name="email"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid || undefined}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    required
                  />
                  {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                </Field>
              );
            }}
          />

          <form.Field
            name="password"
            children={(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid || undefined}>
                  <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    minLength={12}
                    autoComplete="new-password"
                    aria-invalid={isInvalid}
                    required
                  />
                  <FieldDescription>
                    At least 12 characters, with a letter and a number.
                  </FieldDescription>
                  {isInvalid ? <FieldError errors={field.state.meta.errors} /> : null}
                </Field>
              );
            }}
          />
        </FieldGroup>

        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}

        <Button type="submit" disabled={claim.isPending}>
          Create first operator
        </Button>
      </form>
    </main>
  );
}
