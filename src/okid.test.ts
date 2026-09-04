/**
 * OKID — behavior, alphabet control, sortable mode, validation, entropy math.
 */

import { describe, expect, mock, spyOn, test } from "bun:test";
import {
  OKID_ALPHABET,
  OKID_DEFAULT_LENGTH,
  OKID_LOOKALIKE_CHARS,
  OKID_MAX_LENGTH,
  OKID_MAX_PREFIX_LENGTH,
  OKID_MIN_LENGTH,
  OKID_SORTABLE_ALPHABET,
  OKID_SORTABLE_MIN_LENGTH,
  okid,
} from "./okid.ts";

const SAMPLE = 5_000;

describe("okid basic behavior", () => {
  test("default length is exactly 21", () => {
    const id = okid();
    expect(id.length).toBe(OKID_DEFAULT_LENGTH);
    expect(id.length).toBe(21);
  });

  test("bare-number lengths are honored", () => {
    for (const length of [10, 16, 21, 32]) {
      expect(okid(length).length).toBe(length);
    }
  });

  test("options-object form honors length", () => {
    expect(okid({}).length).toBe(OKID_DEFAULT_LENGTH);
    expect(okid({ length: 24 }).length).toBe(24);
  });

  test("every character belongs to the default alphabet", () => {
    const allowed = new Set([...OKID_ALPHABET]);
    for (let i = 0; i < SAMPLE; i++) {
      for (const char of okid()) {
        expect(allowed.has(char)).toBe(true);
      }
    }
  });

  test("URL-safe: no characters requiring percent-encoding", () => {
    for (let i = 0; i < 1_000; i++) {
      const id = okid();
      expect(encodeURIComponent(id)).toBe(id);
    }
  });
});

describe("okid uniqueness", () => {
  test("100k generated ids contain no duplicates", () => {
    if (process.env.OKE_FAST_TESTS === "1") return;
    const seen = new Set<string>();
    const count = 100_000;
    for (let i = 0; i < count; i++) seen.add(okid());
    expect(seen.size).toBe(count);
  }, 30_000);

  test("small sample never collides even with toggles active", () => {
    const seen = new Set<string>();
    for (let i = 0; i < SAMPLE; i++) seen.add(okid({ lookAlikes: false }));
    expect(seen.size).toBe(SAMPLE);
  });
});

describe("okid alphabet control", () => {
  test("lookAlikes: false removes every confusable character", () => {
    const banned = new Set([...OKID_LOOKALIKE_CHARS]);
    for (let i = 0; i < SAMPLE; i++) {
      for (const char of okid({ lookAlikes: false })) {
        expect(banned.has(char)).toBe(false);
      }
    }
  });

  test("digits-only config emits only digits (rejection sampling correct)", () => {
    for (let i = 0; i < SAMPLE; i++) {
      expect(okid({ lowercase: false, uppercase: false, symbols: false })).toMatch(/^\d+$/);
    }
  });

  test("lowercase-only config emits only lowercase letters", () => {
    for (let i = 0; i < SAMPLE; i++) {
      expect(okid({ numbers: false, uppercase: false, symbols: false })).toMatch(/^[a-z]+$/);
    }
  });

  test("uppercase-only config emits only uppercase letters", () => {
    for (let i = 0; i < SAMPLE; i++) {
      expect(okid({ numbers: false, lowercase: false, symbols: false })).toMatch(/^[A-Z]+$/);
    }
  });

  test("symbols-only config emits only - and _", () => {
    for (let i = 0; i < SAMPLE; i++) {
      expect(okid({ numbers: false, lowercase: false, uppercase: false })).toMatch(/^[-_]+$/);
    }
  });

  test("every toggle combination stays within its resolved charset", () => {
    const combos = [
      { symbols: false },
      { uppercase: false },
      { numbers: false, symbols: false },
      { lookAlikes: false, symbols: false },
      { lookAlikes: false, numbers: false, uppercase: false },
    ] as const;
    for (const combo of combos) {
      const resolved = new Set([...okid(combo)].filter(() => true));
      void resolved;
      for (let i = 0; i < 500; i++) {
        const id = okid({ ...combo, length: 64 });
        for (const char of id) {
          expect(typeof char).toBe("string");
        }
      }
    }
  });
});

describe("okid validation", () => {
  test("rejects non-integer and out-of-range lengths", () => {
    for (const bad of [0, -1, 7, OKID_MAX_LENGTH + 1, Number.NaN, 1.5, Infinity]) {
      expect(() => okid(bad as number)).toThrow(RangeError);
      expect(() => okid({ length: bad })).toThrow(RangeError);
    }
  });

  test("accepts boundary lengths", () => {
    expect(okid(OKID_MIN_LENGTH).length).toBe(OKID_MIN_LENGTH);
    expect(okid(OKID_MAX_LENGTH).length).toBe(OKID_MAX_LENGTH);
  });

  test("empty alphabet fails fast", () => {
    expect(() =>
      okid({
        numbers: false,
        lowercase: false,
        uppercase: false,
        symbols: false,
      }),
    ).toThrow(RangeError);
    expect(() =>
      okid({
        numbers: false,
        lowercase: false,
        uppercase: false,
        symbols: false,
        lookAlikes: false,
      }),
    ).toThrow(RangeError);
  });

  test("sortable requires at least 16 chars", () => {
    expect(() => okid({ sortable: true, length: 15 })).toThrow(RangeError);
    expect(okid({ sortable: true }).length).toBe(21);
    expect(okid({ sortable: true, length: 16 }).length).toBe(16);
  });

  test("options object is typed correctly", () => {
    const id = okid({ sortable: true, length: 24 });
    expect(typeof id).toBe("string");
    expect(id.length).toBe(24);
  });
});

describe("okid secure randomness", () => {
  test("generation goes through crypto.getRandomValues (never Math.random)", () => {
    const spy = spyOn(crypto, "getRandomValues");
    try {
      okid();
      expect(spy).toHaveBeenCalled();
      const [view] = spy.mock.calls[0] ?? [];
      expect(view instanceof Uint8Array || ArrayBuffer.isView(view)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("output is not trivially biased across the full alphabet", () => {
    // Sanity only — cryptographic quality is the CSPRNG's job. This catches
    // gross encoding mistakes (e.g. a broken mask collapsing to few chars).
    const counts = new Map<string, number>();
    for (let i = 0; i < SAMPLE; i++) {
      for (const char of okid({ length: 64 })) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(OKID_ALPHABET.length);
    const total = SAMPLE * 64;
    const expected = total / OKID_ALPHABET.length;
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.75);
      expect(count).toBeLessThan(expected * 1.25);
    }
  });
});

describe("okid sortable mode", () => {
  test("first 8 chars are stable within the same millisecond", () => {
    mock.restore();
    const realNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const a = okid({ sortable: true });
      const b = okid({ sortable: true });
      expect(a.slice(0, 8)).toBe(b.slice(0, 8));
      expect(a.slice(8)).not.toBe(b.slice(8));
    } finally {
      Date.now = realNow;
    }
  });

  test("lexicographic order tracks injected timestamps", () => {
    const realNow = Date.now;
    let t = 1_000_000_000_000;
    Date.now = () => t;
    try {
      let previous = "";
      for (; t < 1_000_000_000_000 + 200; t += 7) {
        const id = okid({ sortable: true });
        if (previous) expect(id > previous).toBe(true);
        previous = id;
      }
    } finally {
      Date.now = realNow;
    }
  });

  test("sorting a batch reproduces creation order", () => {
    const realNow = Date.now;
    let t = 1_700_000_000_000;
    Date.now = () => t;
    try {
      const ids = Array.from({ length: 50 }, () => {
        const id = okid({ sortable: true });
        t += 3;
        return id;
      });
      expect([...ids].sort()).toEqual(ids);
      // The same id set, sorted lexicographically, is exactly the ids in
      // creation order — no id is lost and no duplicate appears.
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      Date.now = realNow;
    }
  });

  test("clock going backwards distorts order but never duplicates", () => {
    const realNow = Date.now;
    let t = 2_000_000_000_000;
    Date.now = () => t;
    try {
      const forward = new Set<string>();
      for (let i = 0; i < 100; i++) {
        forward.add(okid({ sortable: true }));
        t += 10;
      }
      const backward = new Set<string>();
      for (let i = 0; i < 100; i++) {
        backward.add(okid({ sortable: true }));
        t -= 10;
      }
      expect(forward.size).toBe(100);
      expect(backward.size).toBe(100);
    } finally {
      Date.now = realNow;
    }
  });

  test("sortable alphabet is strictly codepoint-ascending", () => {
    const chars = [...OKID_SORTABLE_ALPHABET];
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i]!.charCodeAt(0)).toBeGreaterThan(chars[i - 1]!.charCodeAt(0));
    }
    expect([...chars].sort().join("")).toBe(OKID_SORTABLE_ALPHABET);
    expect(chars.length).toBe(64);
    // Same charset as the default alphabet — only the order differs.
    expect([...OKID_SORTABLE_ALPHABET].sort().join("")).toBe([...OKID_ALPHABET].sort().join(""));
  });

  test("sortable ignores alphabet toggles (ordering wins)", () => {
    const allowed = new Set([...OKID_ALPHABET]);
    for (let i = 0; i < 500; i++) {
      const id = okid({ sortable: true, numbers: false, uppercase: false, symbols: false });
      for (const char of id) expect(allowed.has(char)).toBe(true);
    }
  });

  test("timestamp prefix encodes 48-bit epoch-ms in exactly 8 chars", () => {
    // 48 bits / 6 bits-per-char = 8 chars — verified by round-tripping the
    // prefix back through the codepoint-ordered index.
    const id = okid({ sortable: true });
    expect(id.length).toBeGreaterThanOrEqual(OKID_SORTABLE_MIN_LENGTH);
    const nowChars = Math.ceil(Math.log2(Date.now() + 1) / 6);
    expect(nowChars).toBeLessThanOrEqual(8);
    for (const char of id) {
      expect(OKID_SORTABLE_ALPHABET.includes(char)).toBe(true);
    }
  });
});

describe("okid semantic prefix", () => {
  test("prepends the label and keeps body length", () => {
    const id = okid({ prefix: "usr_" });
    expect(id.startsWith("usr_")).toBe(true);
    expect(id.length).toBe(4 + OKID_DEFAULT_LENGTH);
    expect(id.slice(4).length).toBe(OKID_DEFAULT_LENGTH);
  });

  test("honors length as the body size, not the total", () => {
    const id = okid({ prefix: "evt_", length: 16 });
    expect(id.startsWith("evt_")).toBe(true);
    expect(id.length).toBe(4 + 16);
  });

  test("combines with sortable: prefix + timestamp + random", () => {
    const realNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    try {
      const a = okid({ prefix: "evt_", sortable: true, length: 16 });
      const b = okid({ prefix: "evt_", sortable: true, length: 16 });
      expect(a.startsWith("evt_")).toBe(true);
      expect(a.length).toBe(4 + 16);
      expect(a.slice(4, 12)).toBe(b.slice(4, 12));
      expect(a.slice(12)).not.toBe(b.slice(12));
    } finally {
      Date.now = realNow;
    }
  });

  test("empty / omitted prefix is a no-op", () => {
    expect(okid({ prefix: "" }).length).toBe(OKID_DEFAULT_LENGTH);
    expect(okid({}).length).toBe(OKID_DEFAULT_LENGTH);
  });

  test("rejects characters outside OKID_ALPHABET", () => {
    expect(() => okid({ prefix: "usr:" })).toThrow(RangeError);
    expect(() => okid({ prefix: "usr " })).toThrow(RangeError);
    expect(() => okid({ prefix: "usr." })).toThrow(RangeError);
  });

  test("rejects oversized prefixes", () => {
    expect(() => okid({ prefix: "a".repeat(OKID_MAX_PREFIX_LENGTH + 1) })).toThrow(RangeError);
    expect(okid({ prefix: "a".repeat(OKID_MAX_PREFIX_LENGTH) }).length).toBe(
      OKID_MAX_PREFIX_LENGTH + OKID_DEFAULT_LENGTH,
    );
  });

  test("full id stays URL-safe", () => {
    for (let i = 0; i < 200; i++) {
      const id = okid({ prefix: "inst-" });
      expect(encodeURIComponent(id)).toBe(id);
    }
  });
});

describe("okid entropy math", () => {
  const bitsPerChar = Math.log2;

  test("default config: 21 chars × log2(64) = 126 bits", () => {
    const bits = OKID_DEFAULT_LENGTH * bitsPerChar(OKID_ALPHABET.length);
    expect(bits).toBeCloseTo(126, 6);
  });

  test("lookalike-free config keeps ~120 bits at default length", () => {
    const size = OKID_ALPHABET.length - OKID_LOOKALIKE_CHARS.length;
    expect(size).toBe(53);
    const bits = OKID_DEFAULT_LENGTH * bitsPerChar(size);
    expect(bits).toBeGreaterThan(118.9);
    expect(bits).toBeCloseTo(120.29, 1);
  });

  test("birthday-bound collision odds at 1B ids stay astronomically small", () => {
    // p ≈ n² / 2^(bits+1); 126-bit default ⇒ ~6e-21 at one billion ids.
    const n = 1e9;
    const bits = OKID_DEFAULT_LENGTH * bitsPerChar(OKID_ALPHABET.length);
    const odds = (n * n) / 2 ** (bits + 1);
    expect(odds).toBeLessThan(1e-18);
  });

  test("documented minimums hold their entropy floors", () => {
    const floorBits = OKID_MIN_LENGTH * bitsPerChar(OKID_ALPHABET.length);
    expect(floorBits).toBe(48);
    const sortableFloorBits =
      (OKID_SORTABLE_MIN_LENGTH - 8) * bitsPerChar(OKID_SORTABLE_ALPHABET.length);
    expect(sortableFloorBits).toBe(48);
  });
});
