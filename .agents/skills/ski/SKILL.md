---
name: ski
description: Voice loop with the local SKI widget. The user speaks into a floating macOS/Linux/Windows widget; transcripts land in the current project's .ski/events.jsonl. You respond by appending tts.speak commands to .ski/commands.jsonl. The widget shows the reply in a bubble and speaks it through local Kokoro TTS. Trigger when the user asks to "start ski", "use voice mode", "talk to me via the widget", or similar.
---

# SKI — Voice loop with the local widget

You are now the agent-side of a bidirectional voice bridge. The user speaks into a floating widget on their desktop; their speech arrives here as `utterance.final` events. You reply by writing `tts.speak` commands.

## Files (per-project)

Each project that wants to participate has its own `.ski/` folder inside it. The widget can bind multiple projects at once; each project's agent operates against its own folder and only sees its own traffic.

- **Events from the user** (read): `$PWD/.ski/events.jsonl`
- **Commands to the widget** (write): `$PWD/.ski/commands.jsonl`

Where `$PWD` is your current working directory — the project you're running in. Resolve the absolute path once via `pwd` and use the same path throughout the session.

> You do NOT need the user to pick this project in the widget first. When you start the loop (below), the heartbeat announces this folder to the widget over its global socket (`~/.ski/agents.sock`) and the widget **auto-binds** it — the project appears in the widget's list on its own and `.ski/` is created. Just make sure the SKI widget is running.

## Event schema (you receive)

```json
{"event":"session.started","session_id":"<16 hex chars>","project":"<name>","voice":"af_heart","ts":1731510000.0}
{"event":"utterance.final","session_id":"<id>","text":"hey can you check the build","duration_ms":2400,"audio_seconds":2.4,"ts":1731510003.6}
{"event":"utterance.final","session_id":"<id>","text":"what's wrong with this layout","duration_ms":1800,"audio_seconds":1.8,"ts":1731510004.2,"screenshots":["/abs/project/.ski/screenshots/2026-07-15-121314.png"]}
{"event":"tts.done","session_id":"<id>","ts":1731510010.1}
{"event":"tts.interrupted","session_id":"<id>","ts":1731510010.1}
{"event":"meeting.join_request","session_id":"<id>","url":"https://meet.google.com/abc-defg-hij","mode":"webpage-av-screenshare","bot_name":"SKI","notetaker":false,"ts":1731510020.0}
{"event":"agentcall.leave","session_id":"<id>","ts":1731510320.0}
{"event":"screen.captured","session_id":"<id>","path":"/abs/project/.ski/screenshots/2026-07-10-121314.png","ts":1731510400.0}
{"event":"screen.capture_failed","session_id":"<id>","reason":"screen_recording_permission","ts":1731510400.0}
{"event":"summarize","session_id":"<id>","kind":"meeting","transcript_path":"/abs/.ski/agentcall-meetings/2026-07-13-1544-abc.transcript.txt","summary_path":"/abs/.ski/agentcall-meetings/2026-07-13-1544-abc.summary.md","ts":1731510500.0}
```

`session_id` is `SHA-256(absolute project path)` truncated to 16 hex chars — deterministic per project, but you don't need to compute it; just pass it through (or omit) on outgoing commands.

**System notices (Phase AS):** an `utterance.final` event carrying
`"system": true` is a message FROM THE WIDGET, not the user speaking
— its text starts with `[SKI system message …]`. Follow its
instruction (typically: the widget just refreshed this skill's files
after an app update — re-read SKILL.md completely at the given path,
then continue under the new instructions). Do not reply to it, do
not treat it as conversation. The widget keeps installed skill files
current automatically; never edit them by hand.

Three event kinds require action:

- **`utterance.final`** — the user spoke. Reply via `tts.speak`. **Phase CI — it may carry a `screenshots` array** (absolute PNG paths in this project's `.ski/screenshots/`): the user grabbed one or more screenshots with SKI's screenshot hotkey to go with what they said. **Read each image** and use them as visual context for the utterance. **Never skip an utterance that has `screenshots`, even if its `text` is empty** — an empty-text utterance carrying `screenshots` means the user shared screenshots without speaking (they may relate to something said earlier; decide what to do with them yourself, no acknowledgment is required).
- **`meeting.join_request`** _(Phase J, Phase AF modes)_ — the user pasted a meeting URL in the widget and wants a bot in the call. The `notetaker` field picks the mode: `false` (agentic — you join via the `join-meeting` skill and participate) or `true` (notetaker — you spawn the transcriber and walk away). Both modes write a live transcript file SKI displays in its Transcripts window — see step 4 below for the exact spawn recipes. The user has already signed in — the bridge picks up the API key from `~/.agentcall/config.json` automatically. While a bot is in the meeting, the user can keep talking to the widget; their utterances continue to arrive as `utterance.final` events. **You must also emit `agentcall.joined` and `agentcall.left` lifecycle commands so the widget can surface a Leave button** — see "AgentCall lifecycle" below.
- **`agentcall.leave`** _(Phase S)_ — the user pressed the widget's in-row Leave button. Gracefully hang up the bot via the join-meeting skill's stop / leave mechanism, then emit `agentcall.left`.
- **`summarize`** _(Phase BI)_ — SKI wants notes for a finished meeting or recording. Read the clean transcript at `transcript_path`, write Markdown notes to `summary_path`, then emit `summary.ready`. See step 7 below.

The other events are status signals — log or ignore.

**Phase H — multi-project routing:** the widget routes the user's voice to whichever project the user has picked as the "active speak target" in the widget UI. If you stop receiving `utterance.final` events, the user has likely switched the active target to another project; just wait — when they switch back, events resume.

## Command schema (you write)

One JSON object per line, appended to `$PWD/.ski/commands.jsonl`. The widget's file watcher picks up new lines within ~500 ms.

| Command                        | Fields                                                                                            | Effect                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tts.speak`                    | `text` (required), `session_id` (optional), `prefix_project_name` (optional bool)                 | The widget shows the text in a bubble and speaks it via local Kokoro TTS. Replies from non-active projects are auto-prefixed with `From <project>:` by the widget — you don't need to add the prefix yourself.                                                                                                                                                              |
| `tts.cancel`                   | `session_id` (optional)                                                                           | Clears the current spoken reply and flushes the playback queue.                                                                                                                                                                                                                                                                                                             |
| `voice.set`                    | `voice` (required, one of `af_heart`, `am_adam`, `bf_emma`, `bm_george`), `session_id` (optional) | Switch the voice for subsequent replies.                                                                                                                                                                                                                                                                                                                                    |
| `screen.capture` _(Phase AR)_  | `session_id` (optional)                                                                           | The widget captures the user's MAIN display under its own macOS Screen Recording grant (your terminal almost certainly has none — never run `screencapture` yourself; without the grant it silently produces a windowless wallpaper shot) and replies on events.jsonl with `screen.captured {path}` (full-res PNG inside this project) or `screen.capture_failed {reason}`. |
| `agentcall.joined` _(Phase S)_ | `url` (optional), `session_id` (optional)                                                         | Emit immediately after the join-meeting skill confirms the bot is in the call. The widget flips its action row middle slot to **Leave 📞** so the user has a one-click hangup affordance.                                                                                                                                                                                   |
| `agentcall.left` _(Phase S)_   | `session_id` (optional)                                                                           | Emit when the call has ended (user pressed Leave, meeting ended naturally, or the skill errored out). The widget returns the action row to its idle shape.                                                                                                                                                                                                                  |
| `agent.heartbeat` _(Phase T)_  | `ts` (optional, unix seconds)                                                                     | **Emitted automatically by `heartbeat.py` — you should not write these by hand.** Fallback liveness signal used when the Unix domain socket at `agent.sock` isn't reachable. The widget intercepts these in its IPC drain and never propagates them as visible commands — they only refresh the per-project connection dot.                                                 |
| `summary.ready` _(Phase BI)_   | `summary_path` (optional)                                                                         | Emit after you've written the meeting/recording notes to `summary_path` (in response to a `summarize` event). The Transcripts window refreshes to show them.                                                                                                                                                                                                                |
| `summary.failed` _(Phase BI)_  | `reason` (optional)                                                                               | Emit if you couldn't produce notes (empty transcript, error).                                                                                                                                                                                                                                                                                                               |

```bash
# Example reply (resolve path once)
EVENTS="$PWD/.ski/events.jsonl"
COMMANDS="$PWD/.ski/commands.jsonl"

echo '{"command":"tts.speak","text":"Build is green on main."}' >> "$COMMANDS"
```

## How to run the loop

Use the **Monitor + `tail -f` + `grep`** pattern (same as the join-meeting skill). It is kernel-driven — zero idle tokens between utterances, instant reaction when the user speaks.

**1. Start a persistent Monitor that ALSO carries the heartbeat.** The ski skill ships a `heartbeat.py` sibling next to this SKILL.md. It connects to the widget's ONE global socket (`~/.ski/agents.sock`), **announces this project** (the widget auto-binds it — no manual pick needed), and holds the connection so the "connected" dot turns green. Launch it INSIDE the Monitor command so its lifetime is anchored to the monitor shell (`$$` below IS the monitor shell — do NOT background the heartbeat from a separate one-off Bash call; those shells die instantly and the heartbeat would die with them):

```bash
# Ensure the IPC files exist so `tail -f` doesn't error before the
# widget finishes binding (no-ops if they already exist; the widget
# uses the same files).
mkdir -p "$PWD/.ski"; : >> "$PWD/.ski/events.jsonl"; : >> "$PWD/.ski/commands.jsonl"

# Find the ski skill's helper scripts. Global installs are preferred;
# `~/.agents/skills/ski` is the shared cross-tool location.
SKILL_DIR="$HOME/.agents/skills/ski"
[ -f "$SKILL_DIR/heartbeat.py" ] || SKILL_DIR="$HOME/.claude/skills/ski"
[ -f "$SKILL_DIR/heartbeat.py" ] || SKILL_DIR="$PWD/.claude/skills/ski"

python3 "$SKILL_DIR/heartbeat.py" "$HOME/.ski/agents.sock" "$PWD" "$$" &
tail -f "$PWD/.ski/events.jsonl" | grep --line-buffered -E '"event": *"(utterance\.final|meeting\.join_request|agentcall\.leave|screen\.(captured|capture_failed)|summarize|session\.started|tts\.(done|interrupted))"'
```

Call this via the `Monitor` tool with `persistent: true`. Each matching line arrives as a task notification. The `grep --line-buffered` flag is REQUIRED — without it the pipe buffers and you get events in multi-minute bursts.

Heartbeat lifecycle — what you get for free:

- **Auto-binds this project.** Announcing over the global socket adds the project to the widget's list (green dot) even if the user never picked it there. It becomes the active speak target only if none is set — otherwise the user picks it from the list.
- **Lives exactly as long as the loop.** The monitor shell stays alive for the whole `tail | grep` pipeline; when the Monitor is stopped (TaskStop / session end), the shell dies and heartbeat.py exits within ~5 s → dot goes grey.
- **Survives widget restarts.** If the widget quits or relaunches, the script loses the socket and automatically reconnects (and re-announces) when the widget returns — the dot recovers and the project re-appears with no action from you.
- **Zero tokens** after the initial spawn — it's all kernel-driven.

**If the heartbeat dies or the dot stays grey:** check with `pgrep -f "heartbeat.py.*$PWD"`. If nothing is running, the simplest recovery is to restart the whole Monitor (TaskStop the old one, re-run the command above) — that respawns the heartbeat with the correct anchor. Also verify `heartbeat.py` actually exists next to this SKILL.md; if it's missing, reinstall the ski skill from the widget (Preferences → Skill).

**2. For every `utterance.final` notification:**

- Parse the JSON, extract `text`.
- Decide if this is a question/request (respond) or just acknowledgment (skip — keep the reply file quiet).
- If responding, generate a SHORT reply (1–3 sentences max — the bubble is small and the user is in a real-time conversation).
- Append one `tts.speak` line to `commands.jsonl`. Use a Bash `echo` with the JSON inside single quotes, or a HEREDOC for replies containing single quotes.

**3. If the user asks for something requiring tool use** (read a file, search the codebase, run a command):

- First acknowledge with a quick reply: `{"command":"tts.speak","text":"Let me check."}` — so the widget shows immediate feedback.
- Then do the actual work with your normal tools.
- When done, send a second `tts.speak` with the result. Keep it short; offer details if the user asks.

**4. On a `meeting.join_request` notification** _(Phase J + Phase S lifecycle + Phase AF transcript/modes)_:

First, in BOTH modes, mint the meeting transcript file — SKI watches
this directory and shows the transcript live in its Transcripts
window's Meetings section:

```bash
TDIR="$HOME/.ski/agentcall-meetings"
mkdir -p "$TDIR"
# slug = the meeting code from the URL (e.g. abc-defg-hij)
TFILE="$TDIR/$(date +%Y-%m-%d-%H%M)-<slug>.jsonl"
```

**Agentic mode (`notetaker` false or absent)** — you join and participate:

- Acknowledge briefly via `tts.speak`: `{"command":"tts.speak","text":"Joining as <bot_name>."}`.
- **Do NOT greet or introduce yourself to the meeting.** When the
  bridge emits `greeting.prompt` (first participant joins), ignore it
  — send no opening `tts.speak`. This is a SKI-driven meeting: the
  user steers from the widget, so speak only when a participant
  addresses you or asks a question.
- Invoke the `join-meeting` skill with the event's `url`, `mode`, and
  `bot_name` — but spawn its bridge **through the ski tee** so your own
  spoken/chat turns land in the transcript too (the platform never
  transcribes bot audio; the tee is a transparent relay — the bridge
  sees ordinary pipes, your event loop is unchanged, you talk to the
  tee exactly as you would to the bridge). **Join in screenshare mode**
  — use `bridge-visual.py` (`webpage-av-screenshare`), which gives you
  the `pattern` avatar and direct voice with barge-in/interruption
  support. Direct voice and the `pattern` template are already
  `bridge-visual.py`'s defaults, so no extra flags are needed:
  ```bash
  python3 "$SKILL_DIR/meeting_tee.py" --transcript "$TFILE" -- \
    python3 <join-meeting-skill-dir>/scripts/python/bridge-visual.py "<url>" \
      --name "<bot_name>" --template pattern --output "$TFILE"
  ```
  Only if the event's `mode` is exactly `audio` (the user explicitly
  picked voice-only) use `bridge.py` instead — same flags minus
  `--template` (which `bridge.py` doesn't accept). Never pass
  `--voice-strategy`: both bridges hard-code direct voice.
- **As soon as the bridge confirms the bot is in the call** (its
  `call.bot_ready` event), emit `agentcall.joined` so the widget can
  flip to a Leave button:
  ```bash
  echo '{"command":"agentcall.joined","url":"https://meet.google.com/abc-defg-hij"}' >> "$PWD/.ski/commands.jsonl"
  ```
- When the meeting ends (`call.ended`, you exited gracefully, or the
  skill errored out), emit `agentcall.left`:
  ```bash
  echo '{"command":"agentcall.left"}' >> "$PWD/.ski/commands.jsonl"
  ```
- Post a short summary via `tts.speak` so the user knows you're back.
  The widget's `utterance.final` events continue to arrive throughout —
  keep watching them.

**Notetaker mode (`notetaker` true)** — the bot only transcribes; the
user keeps working with you through the widget:

- Acknowledge briefly via `tts.speak`: `{"command":"tts.speak","text":"Sending the notetaker."}`.
- Spawn the plain bridge in the background with `--output` (NO tee —
  a notetaker never speaks, so it always joins in the cheapest
  **audio-only** mode via `bridge.py`, never `bridge-visual.py`) and
  record its PID:
  ```bash
  python3 <join-meeting-skill-dir>/scripts/python/bridge.py "<url>" \
    --name "<bot_name>" --output "$TFILE" >/dev/null 2>&1 &
  NOTETAKER_PID=$!
  ```
- Emit `agentcall.joined` (as above). Then start ONE tiny kernel-driven
  Monitor that fires exactly once when the call ends — you do NOT watch
  the meeting otherwise; zero tokens until it fires:
  ```bash
  tail -f "$TFILE" | grep --line-buffered -m1 '"event": *"call.ended"'
  ```
  When it fires: emit `agentcall.left`, then reap the bridge
  (`kill $NOTETAKER_PID 2>/dev/null || true` — it normally exits by
  itself on call.ended). The platform ends the call automatically when
  everyone else leaves (alone timeout), so "meeting over" needs no
  participant counting.
- **Do not speak in the meeting and do not process its events** — the
  transcript accumulates in `$TFILE` for the user to read in SKI.

**5. On an `agentcall.leave` notification** _(Phase S)_ — the user pressed the widget's in-row Leave button:

- Agentic: gracefully hang up via the bridge (`{"command": "leave"}` on its stdin — through the tee, same as any other command). Notetaker: `kill $NOTETAKER_PID` (SIGTERM; the tail Monitor can be stopped too).
- Emit `agentcall.left` to confirm:
  ```bash
  echo '{"command":"agentcall.left"}' >> "$PWD/.ski/commands.jsonl"
  ```
- Resume the regular ski loop. The widget's row returns to its idle shape.

**6. If the user asks you to look at THEIR OWN screen** _(Phase AR)_ —
their desktop, an app, their editor, "what I'm looking at":

- **Always capture through the widget:** append
  `{"command":"screen.capture"}` to `commands.jsonl`. **Do NOT run
  `screencapture` — or any other screenshot tool — yourself, even if
  it works in your terminal.** Only the widget path (a) logs the shot
  as a **thumbnail in the SKI transcript** (a permanent record the
  user sees in the Sessions window), and (b) grabs the user's real
  main display under SKI's own Screen Recording grant. Your terminal
  may be on a different Space/display, headless, or ungranted — so a
  direct capture is silently the _wrong_ screen (or a blank wallpaper
  shot) and leaves no transcript record. This rule holds regardless
  of whether your own `screencapture` would succeed.
- The widget captures the main display and replies on events.jsonl
  with `screen.captured {path}` (your Monitor delivers it). The
  PNG is full-resolution and lives inside this project at
  `.ski/screenshots/` — Read it and answer the user's question.
- On `screen.capture_failed` with reason
  `screen_recording_permission`, tell the user: enable SKI under
  System Settings → Privacy & Security → Screen Recording, then
  quit and relaunch SKI. Do NOT fall back to `screencapture`
  yourself — that skips the transcript record and may grab the wrong
  display; the fix is the grant.
- **This is the user's LOCAL screen only — NOT a meeting screenshot.**
  If you are in a video call and want to see what's on-screen _inside
  the meeting_ (a shared screen, participant video, the bot's view),
  that is the join-meeting bridge's `screenshot.take` command (sent
  on the bridge's stdin), which captures the meeting's frame — not
  the user's desktop. Different tool, different channel: never use
  `screen.capture` for the meeting view, nor `screenshot.take` for
  the user's desktop.

**7. On a `summarize` notification** _(Phase BI)_ — SKI wants notes for a finished meeting or recording:

- Read the clean transcript at the event's `transcript_path` (SKI already rendered it to readable "Name: text" lines — do NOT go hunting for the raw file).
- Write **Markdown** to the event's `summary_path` with these three sections, in this order, and nothing else:
  ```markdown
  ## Summary

  A short paragraph — what the meeting was about and what happened.

  ## Decisions

  - Each decision that was made (omit the bullet list's contents if none, but keep the heading).

  ## Action items

  - Each to-do or follow-up, with the owner if it's clear (e.g. "Priya: send the pricing deck").
  ```
  Overwrite the file if it already exists. Keep it tight and factual — no preamble, no "here are the notes". If the transcript is too thin to summarize, write a one-line note under `## Summary` and leave the other sections empty.
- Then emit `summary.ready`:
  ```bash
  echo '{"command":"summary.ready","summary_path":"<the summary_path>"}' >> "$PWD/.ski/commands.jsonl"
  ```
  If you couldn't do it, emit `{"command":"summary.failed","reason":"<short reason>"}` instead.
- This is a background side-task — do **not** speak it via `tts.speak`, and return to the regular loop immediately after.

**8. Keep the loop alive until the user explicitly ends it.** Stop the Monitor via `TaskStop` only when:

- The user says "stop", "exit", "end", "quit", "close" via voice or chat, OR
- The user kills the widget (you'll stop receiving events).

## Conversation style

- **Short replies.** This is voice; long replies feel robotic.
- **No preamble.** Don't say "Sure, here's what I found." Say the thing.
- **Mid-task acknowledgments** when an action will take >2 s: `{"command":"tts.speak","text":"On it."}` — then do the work.
- **Don't echo the user's question back.** The user already knows what they said.

## Activating

Once the user asks you to start (or you detect a voice-loop intent), do these in order:

1. Start the Monitor as described in "How to run the loop" above. The heartbeat it launches announces `$PWD` to the widget's global socket, so the widget **auto-binds this project** — you do NOT need the user to pick it in the pill/notch first, and you do NOT need to check whether `.ski/` already exists. (If the SKI widget isn't running, ask the user to start it; the heartbeat reconnects and the project appears the moment it does.)
2. Send a hello so the user knows the loop is live:
   ```bash
   echo '{"command":"tts.speak","text":"Connected. What do you need?"}' >> "$PWD/.ski/commands.jsonl"
   ```
3. From here on, react to each `utterance.final` notification as they arrive.

## Multi-project notes

- Multiple agents can run simultaneously in different projects. Each tails its own `.ski/events.jsonl` and writes to its own `commands.jsonl`. The widget aggregates: only the active project receives the user's speech, but ALL projects' replies are queued and played back FIFO with a `From <project>:` prefix on the bubble + spoken audio (unless the reply is from the active project).
- You don't need to coordinate with other projects' agents — they operate independently, all you do is talk to your own `.ski/`.
