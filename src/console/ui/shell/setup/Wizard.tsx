/**
 * First-admin setup wizard — gated by boot-log claim code.
 * Closes permanently after the first operator (console §2.5).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { consoleCalls, setAccessToken } from "../client.ts";
import { Button, Field, Input } from "../components/ui.tsx";

/**
 * Setup wizard page.
 */
export function SetupWizard() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["console.setup.status"],
    queryFn: async () => {
      const res = await consoleCalls.setupStatus();
      if (res.error) throw new Error(res.error.code);
      return res.data as { setupClosed: boolean; claimRequired: boolean };
    },
  });

  const [claimCode, setClaimCode] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const claim = useMutation({
    mutationFn: async () => {
      const res = await consoleCalls.setupClaim({
        claimCode,
        email,
        name,
        password,
      });
      if (res.error) throw new Error(res.error.code);
      return res.data as { accessToken: string };
    },
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      void qc.invalidateQueries();
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  if (status.isLoading) {
    return <p className="text-[var(--oke-muted)]">Checking setup…</p>;
  }

  if (status.data?.setupClosed) {
    return (
      <section className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">oke Console</h1>
        <p className="text-[var(--oke-muted)]">
          Setup is closed. Sign in with an existing operator account.
        </p>
        <LoginForm />
      </section>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    claim.mutate();
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--oke-muted)]">
          First admin
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">oke Console</h1>
        <p className="text-[var(--oke-muted)]">
          Enter the claim code printed once to the boot log. This wizard closes
          permanently after the first operator.
        </p>
      </header>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} autoComplete="off">
        <Field label="Claim code">
          <Input
            name="claimCode"
            value={claimCode}
            onValueChange={(v) => setClaimCode(String(v ?? ""))}
            autoComplete="off"
            required
          />
        </Field>
        <Field label="Name">
          <Input
            name="name"
            value={name}
            onValueChange={(v) => setName(String(v ?? ""))}
            required
          />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            value={email}
            onValueChange={(v) => setEmail(String(v ?? ""))}
            required
          />
        </Field>
        <Field label="Password">
          <Input
            name="password"
            type="password"
            value={password}
            onValueChange={(v) => setPassword(String(v ?? ""))}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </Field>
        {formError ? (
          <p className="text-sm text-[var(--oke-danger)]" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" disabled={claim.isPending}>
          Create first operator
        </Button>
      </form>
    </section>
  );
}

function LoginForm() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: async () => {
      const res = await consoleCalls.sessionLogin({ email, password });
      if (res.error) throw new Error(res.error.code);
      return res.data as { accessToken: string };
    },
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      void qc.invalidateQueries();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        login.mutate();
      }}
    >
      <Field label="Email">
        <Input
          type="email"
          value={email}
          onValueChange={(v) => setEmail(String(v ?? ""))}
          required
        />
      </Field>
      <Field label="Password">
        <Input
          type="password"
          value={password}
          onValueChange={(v) => setPassword(String(v ?? ""))}
          required
        />
      </Field>
      {formError ? (
        <p className="text-sm text-[var(--oke-danger)]" role="alert">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={login.isPending}>
        Sign in
      </Button>
    </form>
  );
}
