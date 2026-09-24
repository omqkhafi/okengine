/**
 * `oke dev` reloads the decision lockfile without a restart.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DECISION_LOCK_FILENAME,
  getDecisionLock,
  resetDecisionCertificates,
} from "../elements/ai/decisions/certificate.ts";
import { watchDecisionLockfile } from "./decision-lock-watch.ts";

describe("decision lockfile watch", () => {
  test("a change calls setDecisionLock without restarting", async () => {
    resetDecisionCertificates();
    const root = await mkdtemp(join(tmpdir(), "oke-lock-"));
    const path = join(root, DECISION_LOCK_FILENAME);
    await Bun.write(
      path,
      `${JSON.stringify({ decisions: { triage: { model: "m", questions: {} } } })}\n`,
    );
    let listener: ((event: "rename" | "change", filename: string | null) => void) | undefined;
    const watch = watchDecisionLockfile(root, (_path, _options, next) => {
      listener = next;
      return { close() {} };
    });
    listener?.("change", DECISION_LOCK_FILENAME);
    await watch.flushed();
    expect(getDecisionLock()?.decisions.triage?.model).toBe("m");

    await Bun.write(
      path,
      `${JSON.stringify({ decisions: { route: { model: "n", questions: {} } } })}\n`,
    );
    listener?.("change", DECISION_LOCK_FILENAME);
    await watch.flushed();
    expect(getDecisionLock()?.decisions.route?.model).toBe("n");
    expect(getDecisionLock()?.decisions.triage).toBeUndefined();
    watch.close();
    resetDecisionCertificates();
  });
});
