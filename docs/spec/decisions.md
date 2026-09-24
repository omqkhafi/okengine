# Decisions

`fx.decide` asks a System One model one or more typed questions and returns values the Flow can act on. Autonomy is granted only by `oke-decisions.lock.json`. The runtime can only take a non-auto path.

## Declaration

```ts
ai.decision(name, {
  model?,
  in,
  ask,
  autonomy?: { maxError, audit },
  review?: Gate,
  onUncertain?: "abstain",
  locale?: (input) => string | undefined,
  evals?,
})
```

Exactly one of `review` and `onUncertain: "abstain"` is required. Declaring both, or neither, is a compile error. `autonomy` requires `audit`.

Builders: `ai.choice(instructions, options)`, `ai.score(instructions, levels)`, `ai.boolean(instructions, criteria?)`. Every choice injects `none_of_these`. Author choice maps allow at most 254 options. Score levels are 2–10. Question ids `meta` and `$` are reserved. `ask` must not be empty.

`ai.boolean` is `noul` on the wire. The default model is OpenRouter `typesafe/jev-1.13`. `driverId: "typesafe"` pins `jev-1.13.0`. Absent `locale` is one certificate slice.

A `review` decision used from an HTTP-triggered Flow is a compile error, durable or not. A park returns no body (HTTP 204). Emit a signal and decide in a consumer. A `review` decision also requires `durable: true`.

## Result

`$.<question>.how` is `"auto"`, `"reviewed"`, or `"abstained"`. The value is `null` only when `how` is `"abstained"`. A sampled question sets `$.<question>.audited: true` and still returns the auto value. `$` also carries calibrated `p`, the raw distribution, and `meta` (resolved model, provider, usage).

## Paths

Review mode parks every non-auto path: low confidence, missing or stale certificate, version mismatch, uncertified locale, drift, and provider outage. The run waits until the review Gate resolves it. There is no default timeout. One decision produces one review.

Abstain mode returns `null` on those same paths and does not park. It may run in a non-durable Flow.

An audit draw does not park. After the auto value is returned, the item is queued for review only to produce a label. The draw is seeded and journaled. Propensity is recorded. Replay does not sample again.

Labels are written when a review resolves, including an audit review. That write belongs to the reviewer Flow, not the Flow that called `fx.decide`. Labels are tenant-scoped and store locale when one was computed.

## Providers

`DecisionProvider` is raw HTTP. TypeSafe is `POST https://api.typesafe.ai/v1/systemone`. OpenRouter is `POST https://openrouter.ai/api/alpha/decisions`. One request carries every question.

Retry `429` and `529` and honor `Retry-After`. The circuit breaker opens only on network errors, timeouts, 5xx, and 529. `401`, `402`, and `422` throw typed errors and do not open it. An open breaker is an outage (a non-auto path).

## Certificates

`oke-decisions.lock.json` lives next to the app's OKE config. Per decision: pinned resolved model version. Per question, and per locale slice when `locale` is declared: question hash, calibrator (temperature for choice and score, beta or Platt for boolean), Learn-then-Test threshold at `maxError`, and metrics.

A Clock job sums label counts across tenants into one app-wide candidate. Drift sets one app-level suspension flag and emits a Signal. `oke decide promote <name>` fetches that candidate from an operator-authenticated admin endpoint and writes the lockfile. `oke eval --certify` builds one from the seed eval file.

Seed evals are JSONL: `{ id?, input, expect: { <question>: value }, locale? }`.

## Out of scope

Composites, conformal sets, shadow challengers, providers other than TypeSafe and OpenRouter, and order or injection probes.
