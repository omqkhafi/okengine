#!/usr/bin/env python3
"""SKI meeting tee — transparent relay around the AgentCall bridge.

Spawned by the agent INSTEAD of the bridge for agentic meetings:

    python3 meeting_tee.py --transcript FILE -- \
        python3 .../bridge.py URL --name SKI --output FILE

Everything the agent writes to stdin is forwarded byte-for-byte to
the bridge; everything the bridge prints is forwarded byte-for-byte
back. The bridge cannot tell the tee exists (it sees ordinary pipes,
exactly as when spawned directly) and no AgentCall file changes.

The one thing the tee adds: as the agent's `tts.speak` / `send_chat` /
`leave` command lines flow past, a copy lands in the transcript file as
`bot.speak` / `bot.chat` / `bot.leave` events (with timestamps) — the
bot's side of the meeting, which the bridge's own `--output` can never
contain because the platform doesn't transcribe bot audio and `--output`
only mirrors bridge OUTPUT, not the commands going in. `bot.leave` is the
reliable end signal: the bridge tears down on `leave` and the server's
`call.ended` often never reaches `--output` before the process exits.

Stdlib only. Exits with the bridge's exit code; forwards SIGTERM /
SIGINT to the bridge so the agent's normal cleanup works unchanged.
"""

import argparse
import json
import signal
import subprocess
import sys
import threading
import time


def main() -> None:
    ap = argparse.ArgumentParser(description="SKI meeting tee")
    ap.add_argument("--transcript", required=True, help="JSONL file to append bot turns to")
    ap.add_argument("cmd", nargs=argparse.REMAINDER, help="-- followed by the bridge command")
    args = ap.parse_args()

    cmd = args.cmd
    if cmd and cmd[0] == "--":
        cmd = cmd[1:]
    if not cmd:
        print("[meeting_tee] no bridge command given after --", file=sys.stderr)
        sys.exit(2)

    child = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,  # bridge stderr inherits ours — debug output unchanged
        text=True,
        bufsize=1,
    )

    def log_bot(line: str) -> None:
        """Copy an outbound speak/chat command into the transcript."""
        try:
            obj = json.loads(line)
        except Exception:
            return
        cmd_name = obj.get("command", "")
        ctype = obj.get("type", "")
        if cmd_name == "tts.speak" and obj.get("text"):
            rec = {"event": "bot.speak", "text": obj["text"], "ts": time.time()}
        elif cmd_name == "send_chat" and obj.get("message"):
            rec = {"event": "bot.chat", "text": obj["message"], "ts": time.time()}
        elif cmd_name in ("leave", "meeting.leave") or ctype == "meeting.leave":
            # The agent is ending the call. The bridge tears down on `leave`
            # and the server's `call.ended` OFTEN never reaches --output
            # before the process exits (verified live). Record the end HERE,
            # on the command path — written before the line is forwarded, so
            # it survives the teardown. SKI treats bot.leave like call.ended.
            rec = {"event": "bot.leave", "ts": time.time()}
        else:
            return
        try:
            with open(args.transcript, "a") as f:
                f.write(json.dumps(rec) + "\n")
        except Exception:
            pass  # transcript logging must never break the call

    def pump_stdin() -> None:
        try:
            for line in sys.stdin:
                log_bot(line)
                try:
                    child.stdin.write(line)
                    child.stdin.flush()
                except Exception:
                    break
        finally:
            try:
                child.stdin.close()
            except Exception:
                pass

    def pump_stdout() -> None:
        for line in child.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()

    def forward_signal(sig, _frame) -> None:
        try:
            child.send_signal(sig)
        except Exception:
            pass

    signal.signal(signal.SIGTERM, forward_signal)
    signal.signal(signal.SIGINT, forward_signal)

    threading.Thread(target=pump_stdin, daemon=True).start()
    out_thread = threading.Thread(target=pump_stdout, daemon=True)
    out_thread.start()

    rc = child.wait()
    out_thread.join(timeout=2)
    sys.exit(rc)


if __name__ == "__main__":
    main()
