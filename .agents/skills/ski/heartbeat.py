#!/usr/bin/env python3
"""
SKI agent liveness + project auto-bind.

The ski skill backgrounds this when the voice loop starts. It connects
to the widget's ONE global Unix socket (~/.ski/agents.sock) and
announces the project it's running in. Two things happen:

  1. AUTO-BIND — the widget binds the announced project, so a session
     started in ANY folder appears in the widget's project list without
     the user having to pick it in the pill/notch first.
  2. LIVENESS  — the open connection is "connected" (green dot). When
     this process exits (the agent's shell dies), the kernel closes the
     socket, the widget sees EOF, and the dot greys — instantly, no
     polling, no token cost.

The loop RECONNECTS: if the widget isn't up yet, or restarts, this keeps
trying; the project pops into the list the moment the widget is
available, and the dot recovers on its own after a restart.

Lifetime: the script exits when the anchor process dies. Anchor it to
something that lives exactly as long as the voice loop — the skill runs
it INSIDE the Monitor's shell command, so `$$` is the monitor shell,
which the harness kills when the loop stops.

Args:
    sys.argv[1] — absolute path to the global socket (~/.ski/agents.sock)
    sys.argv[2] — absolute path to the project root ($PWD)
    sys.argv[3] — PID of the anchor process to follow
"""

import json
import os
import socket
import sys
import time


PARENT_CHECK_TICK_S = 5    # how often to re-check the anchor while holding
RECONNECT_DELAY_S = 2      # pause between (re)connect attempts

# This script lives INSIDE the skill folder, so its own location tells
# the widget where the install is — used to keep the skill files current
# after app updates (Phase AS), for any install location.
SKILL_DIR = os.path.dirname(os.path.abspath(__file__))


def parent_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except PermissionError:
        # The pid exists but belongs to another user — still alive.
        return True
    except (ProcessLookupError, OSError):
        return False


def hold_socket(sock_path: str, project_root: str, anchor_pid: int) -> bool:
    """Connect once, announce the project, and hold until the peer
    closes or the anchor dies. Returns True if a connection was
    established (regardless of how it ended), False if connect failed
    (caller retries)."""
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(2.0)
    try:
        s.connect(sock_path)
    except (FileNotFoundError, ConnectionRefusedError, OSError):
        try:
            s.close()
        finally:
            return False

    # Announce: the widget auto-binds `project_root` and (Phase AS)
    # heals the install at `skill_dir`. One newline-terminated hello.
    try:
        s.sendall(
            (
                json.dumps(
                    {
                        "hello": "ski-heartbeat",
                        "project_root": project_root,
                        "skill_dir": SKILL_DIR,
                        "pid": os.getpid(),
                    }
                )
                + "\n"
            ).encode()
        )
    except OSError:
        try:
            s.close()
        finally:
            return False

    s.settimeout(PARENT_CHECK_TICK_S)
    try:
        while parent_alive(anchor_pid):
            try:
                data = s.recv(64)
                if not data:
                    # Widget closed the socket (restart) — reconnect.
                    break
            except socket.timeout:
                continue  # normal — just re-check the anchor
            except OSError:
                break
    finally:
        try:
            s.close()
        except OSError:
            pass
    return True


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "usage: heartbeat.py <~/.ski/agents.sock> <project_root> <anchor_pid>",
            file=sys.stderr,
        )
        return 2

    sock_path = sys.argv[1]
    project_root = sys.argv[2]
    try:
        anchor_pid = int(sys.argv[3])
    except ValueError:
        print("anchor_pid must be an integer", file=sys.stderr)
        return 2

    # Guard against a self-referential anchor ($$ expanding to OUR pid
    # via an exec-ing shell): checking our own liveness would keep the
    # script alive forever. Fall back to our parent process instead.
    if anchor_pid == os.getpid() or anchor_pid <= 1:
        anchor_pid = os.getppid()
        if anchor_pid <= 1:
            print("no valid anchor process; exiting", file=sys.stderr)
            return 2

    # Reconnect-forever loop: connect, announce, hold; on any loss (or
    # while the widget is down) pause briefly and try again.
    while parent_alive(anchor_pid):
        hold_socket(sock_path, project_root, anchor_pid)
        time.sleep(RECONNECT_DELAY_S)
    return 0


if __name__ == "__main__":
    sys.exit(main())
