# Deciders

A decision names the questions. A decider is one model that can answer them. Autonomy is a certificate on that decider, not a property of the decision.

## Declare

```typescript
const jev = ai.decider("jev", {
  provider: "openrouter",
  model: "typesafe/jev-1.13-20260917",
});

const triage = ai.decision("triage", {
  decider: jev,
  backup: [],
  otherwise: ops, // a Gate, or "abstain"
  ask: {
    team: ai.choice("Which team owns this ticket?", {
      billing: "Billing",
      technical: "Technical",
    }),
  },
});
```

`decider` and `otherwise` are required. There is no default decider. `model`, `driverId`, `review`, and `onUncertain` are gone.

`otherwise: Gate` parks for that gate. The flow must be durable and must not be HTTP. `otherwise: "abstain"` returns null and does not park.

`backup` runs only when the previous decider is an outage: open breaker, HTTP 5xx, or timeout. A 4xx is `DecisionRequestError`. It does not open the breaker and does not try the backup.

`shadow` is reserved. Using it fails to compile with a message that says it is planned.

## Protocols

Two codecs, both normalized to one internal answer (`boolean`, `choice`, `score`, `refusal`, `malformed`):

| Protocol           | Wire                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemone`        | `POST` body `{ model, state, questions }` with `noul` / `choice` / `score`. Answers are an object.                                                                                    |
| `openai-decisions` | `POST /v1/decisions` with `{ model, input, questions }`. `input` is a string. Object state is `JSON.stringify`. Answers are an array of `predicate` / `choice` / `score` / `refusal`. |

Presets:

| Provider     | Protocol           | URL                                         | Secret               | Pinning | Capabilities                                            |
| ------------ | ------------------ | ------------------------------------------- | -------------------- | ------- | ------------------------------------------------------- |
| `openrouter` | `systemone`        | `https://openrouter.ai/api/alpha/decisions` | `OPENROUTER_API_KEY` | `dated` | boolean, choice, score. No refusal type on the request. |
| `openai`     | `openai-decisions` | `https://api.openai.com/v1/decisions`       | `OPENAI_API_KEY`     | `alias` | boolean, choice, score, refusal.                        |

Every other host passes `driverId` (`systemone` or `openai-decisions`), `baseUrl`, `secret`, and `capabilities`. No other preset is shipped.

`region` and `zdr` are fields. A value that was not verified against the provider is stored as `declared`. Preset rows have no verified region or ZDR.

Numeric limits (`maxChoices`, `minLevels`, `maxLevels`, `maxContext`) apply only when the capability row contains that number. Presets do not invent one.

State larger than `maxContext` (estimated as `ceil(JSON.stringify(state).length / 4)`) throws `DecisionInputTooLarge` before any call. It does not take `otherwise`.

## Result

`$.<question>` keeps `how` (`auto` | `reviewed` | `abstained`), `p`, `raw`, and `audited`. `by` is the decider that answered. `why` is present only when the question is not auto:

`uncertain` | `refused` | `none_of_these` | `uncertified` | `drift` | `outage`

A refusal is not a label. It takes `otherwise` with `why: "refused"` and `by`.

Auto is allowed only when the answering decider's own certificate matches the echoed model, is unexpired, matches the question hash, and the calibrated score clears the threshold.

## Certificates

Lockfile version is `2`:

```json
{
  "version": 2,
  "decisions": {
    "triage": {
      "deciders": {
        "jev": {
          "model": "typesafe/jev-1.13-20260917",
          "pinned": true,
          "questions": {}
        }
      }
    }
  }
}
```

A version 1 file fails with a message to recertify. A different echoed model at runtime is `why: "uncertified"`. A decider that already has a certificate does not need another one when it is selected as backup.

## CLI

`oke decide certify <name> --deciders a,b` writes one certificate per decider and prints accuracy, ECE, certified coverage, p50, p95, and cost. `oke decide models` lists decision models from the catalog fields that exist (id, canonical slug, context, input modalities). `oke decide promote` and `oke decide labels` stay. `oke eval --certify` is removed.

`drivers.decide` follows `drivers.ai`. The default is `{ test: "mock" }`. Unset dev and prod call the host. `t.ai.decide(decision, answers)` scripts probabilities, or `{ refusal: "..." }` as a test signal. The refusal string is not stored.

## Amendments after Phase 0

1. **Pinning.** Each provider row records `pinning: "dated" | "alias"`.
   - OpenRouter is `dated`: certificates bind to the echoed canonical slug.
   - OpenAI is `alias`: the certificate binds to the echoed id and is stored with `pinned: false` and `expiresAt` = certify time + 30 days.
   - After expiry, answers go to `otherwise` with `why: "uncertified"`.
   - `oke decide certify` prints that the model is unpinned, and Console shows it.
   - If the provider lists a dated id for the model, autonomy requires the decider to use it.
2. **Refusal.** There is no refusal text field. A refusal routes to `otherwise` with `why: "refused"` and `by`; the review row shows "refused by <decider>".
3. **Provider rows.** Ship presets for `openrouter` (System One) and `openai` (OpenAI decisions) only, with values you verified.
   - Every other host uses `driverId` + `baseUrl` + `capabilities`.
   - `region` and `zdr` stay as fields. Where a row has no verified value, they are accepted as the app's declaration and the Manifest marks them `declared`, not `verified`.
4. **Kernel budget.**
   - Baseline: `budgets.json` 14,704 B gzip, cap 17,408.
   - This PR may add at most 256 B; above that, stop with numbers.
   - Add a reported, ungated row for the decision chunk.
5. **Console and MCP.** Console keeps resolving reviews (a human action). MCP stays read-only, with `by`, `why` and per-decider certificates added.
6. **CLI registry.** It must list `promote`, `labels` and the new `certify` and `models`, with the registry test updated.
