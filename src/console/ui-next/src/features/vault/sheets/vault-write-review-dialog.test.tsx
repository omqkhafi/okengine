/**
 * Review pause — facts appear before mutation; Cancel does not commit.
 *
 * AlertDialog itself needs a browser (Floating UI). The gate + facts are
 * what make Cancel abort and Confirm the only write.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, type JSX } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fingerprintSecretSync } from "../../../../../../elements/vault/fingerprint.ts";
import {
  cancelVaultWrite,
  confirmVaultWrite,
  openVaultWriteReview,
  type VaultWriteReview,
} from "../lib/write-review.ts";
import { VaultWriteReviewFacts } from "./vault-write-review-dialog.tsx";

const SECRET = "ghp_do_not_show_in_dialog";

function ReviewHarness({
  review,
  onCancel,
  onConfirm,
}: {
  readonly review: VaultWriteReview;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): JSX.Element {
  return (
    <div data-slot="vault-write-review">
      <p>Confirm rotate {review.name}</p>
      <VaultWriteReviewFacts review={review} />
      <button type="button" data-slot="vault-write-review-cancel" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" data-slot="vault-write-review-confirm" onClick={onConfirm}>
        Rotate
      </button>
    </div>
  );
}

describe("VaultWriteReviewDialog", () => {
  let window: Window;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window = new Window({ url: "http://console.test/vault" });
    Object.defineProperty(globalThis, "window", {
      value: window,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: window.document,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      value: window.HTMLElement,
      configurable: true,
      writable: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.close();
  });

  test("dialog shows name, fingerprint, reason — not the secret — and Cancel aborts", async () => {
    const writes: string[] = [];
    const opened = await openVaultWriteReview({
      action: "rotate",
      name: "GITHUB_TOKEN",
      value: SECRET,
      sensitive: true,
      reason: "Scheduled rotation",
    });
    expect("error" in opened).toBe(false);
    if ("error" in opened) return;

    let review: VaultWriteReview | null = opened;
    const rerender = (): void => {
      if (!review) {
        root.render(<div data-slot="vault-write-review-closed" />);
        return;
      }
      root.render(
        <ReviewHarness
          review={review}
          onCancel={() => {
            review = cancelVaultWrite();
            rerender();
          }}
          onConfirm={() => {
            confirmVaultWrite(review, (next) => {
              writes.push(next.commit.value);
            });
          }}
        />,
      );
    };

    await act(async () => {
      rerender();
    });

    const dialog = container.querySelector("[data-slot=vault-write-review]");
    expect(dialog).not.toBeNull();
    const text = dialog?.textContent ?? "";
    expect(text).toContain("GITHUB_TOKEN");
    expect(text).toContain(fingerprintSecretSync(SECRET));
    expect(text).toContain("Scheduled rotation");
    expect(text).not.toContain(SECRET);
    expect(writes).toEqual([]);

    const cancel = container.querySelector("[data-slot=vault-write-review-cancel]");
    expect(cancel).toBeInstanceOf(window.HTMLElement);
    await act(async () => {
      (cancel as HTMLElement).click();
    });
    expect(writes).toEqual([]);
    expect(container.querySelector("[data-slot=vault-write-review]")).toBeNull();
    confirmVaultWrite(review, (next) => writes.push(next.commit.value));
    expect(writes).toEqual([]);
  });

  test("Confirm is the mutation", async () => {
    const writes: string[] = [];
    const opened = await openVaultWriteReview({
      action: "create",
      name: "ISSUE_PEPPER",
      value: SECRET,
      sensitive: true,
      kind: "secret",
      rotate: "never",
    });
    expect("error" in opened).toBe(false);
    if ("error" in opened) return;

    await act(async () => {
      root.render(
        <ReviewHarness
          review={opened}
          onCancel={() => undefined}
          onConfirm={() => {
            confirmVaultWrite(opened, (next) => {
              writes.push(next.commit.value);
            });
          }}
        />,
      );
    });

    expect(writes).toEqual([]);
    const confirm = container.querySelector("[data-slot=vault-write-review-confirm]");
    expect(confirm).toBeInstanceOf(window.HTMLElement);
    await act(async () => {
      (confirm as HTMLElement).click();
    });
    expect(writes).toEqual([SECRET]);
  });
});
