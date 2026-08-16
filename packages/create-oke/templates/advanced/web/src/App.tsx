import { useCallback, useEffect, useState, type FormEvent, type JSX } from "react";
import { isOk } from "okengine/client";
import { api, type Note } from "./client.ts";
import "./App.css";

/**
 * Notes SPA — health + list + create + archive against the oke app.
 */
export function App(): JSX.Element {
  const [health, setHealth] = useState<"unknown" | "ok" | "down">("unknown");
  const [notes, setNotes] = useState<readonly Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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
  }, [refresh]);

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
      </header>

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
