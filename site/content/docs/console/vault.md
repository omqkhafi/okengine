---
title: "Vault"
description: "Secret contracts, who can read each, rotation due."
source: "docs/spec/console.md"
---

#### 9.8 Vault

**The hardest design constraint in the Console: secrets are write-only.** The panel can set and rotate; it can never reveal. So what can it usefully show?

**Fingerprints.** A short salted hash of the value, shown per environment. This answers the questions people actually ask — did the rotation reach production? do staging and production share a key, and is that intended? — without a single character being exposed. `prod = staging` is rendered as a warning rather than an error, because it may be deliberate; claiming to know intent produces false alarms, and false alarms get muted.

**The resolution chain is shown in full** — which of `process.env`, `.env.local`, `.env.stack`, the vault driver or the dev fallback actually won. "Why is the app using the wrong key?" becomes a glance instead of an investigation.

**Who can read it is derived from effects** — the flows that declare `fx.vault(x)`. Least-privilege review becomes a query.

**Rotation blast radius includes in-flight durable runs.** Rotating a secret while journaled flows sleep mid-execution means they wake holding a new key and may fail a step that would have succeeded. The warning gives a count and the longest outstanding wake, so the choice is informed: rotate now, wait, or wake them early from the Clock panel. No other tool can even pose the question.

**Last-read timestamps** expose dead secrets — attack surface grows by forgetting, not only by adding. Config values (non-sensitive) are shown in the clear; only secrets are fingerprinted.
