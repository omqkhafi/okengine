import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";
import { isOk } from "okengine/client";
import { Can } from "okengine/client-react";
import { api, type Note } from "./client.ts";
import "./App.css";

/**
 * Notes SPA — health + list + create + archive against the oke app.
 * Auth chrome uses Can (UI-only); Gate on Flows remains real authz.
 */
export function App(): JSX.Element {
  const [health, setHealth] = useState<"unknown" | "ok" | "down">("unknown");
  const [notes, setNotes] = useState<readonly Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("demo@localhost");
  const [password, setPassword] = useState("password-demo-1");
  const [sessionLabel, setSessionLabel] = useState<string>("…");

  const refreshSession = useCallback(async () => {
    if (!api.auth) {
      setSessionLabel("no auth");
      return;
    }
    const user = await api.auth.getSession();
    setSessionLabel(user ? `${user.email ?? user.userId}` : "signed out");
  }, []);

  const refresh = useCallback(async () => {
    const live = await api.main.health({});
    setHealth(isOk(live) && live.data.ok ? "ok" : "down");
    const listed = await api.notes.list({});
    if (isOk(listed) && Array.isArray(listed.data)) {
      setNotes(listed.data as readonly Note[]);
      setMessage(null);
      return;
    }
    setMessage(listed.error?.code ?? "notes.list failed");
  }, []);

  useEffect(() => {
    void refresh();
    void refreshSession();
  }, [refresh, refreshSession]);

  async function onSignIn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!api.auth) return;
    const result = await api.auth.signIn.email({ email, password });
    if (!result.ok) {
      setMessage("sign-in failed — try sign-up first");
      return;
    }
    setMessage(null);
    await refreshSession();
  }

  async function onSignUp(): Promise<void> {
    if (!api.auth) return;
    const result = await api.auth.signUp.email({ email, password, name: "Demo" });
    if (!result.ok) {
      setMessage("sign-up failed");
      return;
    }
    setMessage(null);
    await refreshSession();
  }

  async function onPasskey(): Promise<void> {
    if (!api.auth) return;
    const result = await api.auth.signIn.passkey({ email });
    if (!result.ok) {
      setMessage("passkey failed — register a passkey while signed in");
      return;
    }
    setMessage(null);
    await refreshSession();
  }

  async function onSignOut(): Promise<void> {
    if (!api.auth) return;
    await api.auth.signOut();
    await refreshSession();
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const created = await api.notes.create({ title, body });
    if (!isOk(created)) {
      setMessage(created.error.code);
      return;
    }
    setTitle("");
    setBody("");
    await refresh();
  }

  async function onArchive(id: string): Promise<void> {
    const archived = await api.notes.archive({ id });
    if (!isOk(archived)) {
      setMessage(archived.error.code);
      return;
    }
    await refresh();
  }

  return (
    <main className="page">
      <header className="head">
        <h1>Notes</h1>
        <p className={health === "ok" ? "ok" : "down"}>
          {health === "unknown" ? "checking…" : health === "ok" ? "app up" : "app down — start oke dev"}
        </p>
        <p className="session">{sessionLabel}</p>
      </header>

      <form className="compose" onSubmit={(event) => void onSignIn(event)}>
        <input
          name="email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit">Sign in</button>
        <button type="button" onClick={() => void onSignUp()}>
          Sign up
        </button>
        <button type="button" onClick={() => void onPasskey()}>
          Passkey
        </button>
        <button type="button" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </form>

      <form className="compose" onSubmit={(event) => void onCreate(event)}>
        <input
          name="title"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
        />
        <textarea
          name="body"
          placeholder="Body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          maxLength={10_000}
          rows={4}
        />
        <button type="submit">Create</button>
      </form>

      {api.auth ? (
        <Can
          auth={api.auth}
          all={["notes:write"]}
          fallback={
            <p className="hint">
              UI chrome: missing notes:write (authorize is UI-only — Gate on Flows is real authz).
            </p>
          }
          loading={<p className="hint">Checking session…</p>}
        >
          <p className="hint">UI chrome: notes:write — editor affordances can show here.</p>
        </Can>
      ) : null}

      {message ? <p className="err">{message}</p> : null}

      <ul className="list">
        {notes.map((note) => (
          <li key={note.id}>
            <div>
              <strong>{note.title}</strong>
              <p>{note.body}</p>
            </div>
            <button type="button" onClick={() => void onArchive(note.id)}>
              Archive
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
