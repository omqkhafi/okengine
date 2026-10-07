# Decisions

`fx.decide` asks one or more typed questions of a decider and returns values the Flow can act on. Autonomy is a certificate on that decider, stored in `oke-decisions.lock.json` version 2. The runtime takes `otherwise` on every path that is not auto.

## Declaration

```ts
ai.decider(name, {
  provider?: "openrouter" | "openai",
  driverId?: "systemone" | "openai-decisions",
  baseUrl?: string,
  model: string,
  secret?: string,
  region?: string,
  zdr?: boolean,
  timeout?: number | string,
  concurrency?: number,
  capabilities?: { boolean, choice, score, refusal, maxChoices?, minLevels?, maxLevels?, maxContext? },
})

ai.decision(name, {
  decider: Decider,
  backup?: Decider[],
  otherwise: Gate | "abstain",
  ask,
  autonomy?: { maxError, audit, risk? },
  locale?: (input) => string | undefined,
  evals?,
  in?,
})
```

`decider` and `otherwise` are required. There is no default decider. `model`, `driverId`, `review`, and `onUncertain` are not decision fields. `shadow` fails to compile with a message that says it is planned.

`otherwise: Gate` parks. The Flow must be durable and must not be HTTP. `otherwise: "abstain"` returns null and does not park.

`backup` runs only on outage: open breaker, HTTP 5xx, or timeout. HTTP 4xx is `DecisionRequestError`. It does not open the breaker and does not try the backup.

Builders: `ai.choice`, `ai.score`, `ai.boolean`. Every choice injects `none_of_these`. Question ids `meta` and `$` are reserved. Numeric choice and level limits apply only when that decider's capability row contains the number.

State larger than `maxContext` (estimated as `ceil(JSON.stringify(state).length / 4)`) throws `DecisionInputTooLarge` before any call.

## Result

`$.<question>` carries `how` (`auto` | `reviewed` | `abstained`), `p`, `raw`, `audited`, and `by`. `why` is present only when the question is not auto: `uncertain` | `refused` | `none_of_these` | `uncertified` | `drift` | `outage`.

A refusal is not a label. It takes `otherwise` with `why: "refused"` and `by`. The review row shows `refused by <decider>`.

Auto is allowed only when the answering decider holds its own certificate: echoed model, unexpired, question hash, and threshold.

## Protocols

| Protocol           | Wire                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `systemone`        | `POST` `{ model, state, questions }`. Answers are an object of `noul`, `choice`, or `score`.                                     |
| `openai-decisions` | `POST` `{ model, input, questions }`. `input` is a string. Answers are an array of `predicate`, `choice`, `score`, or `refusal`. |

Presets: `openrouter` (System One, dated pinning, `OPENROUTER_API_KEY`) and `openai` (OpenAI decisions, alias pinning, `OPENAI_API_KEY`). Every other host uses `driverId`, `baseUrl`, and `capabilities`. `region` and `zdr` without a verified provider value are `declared` on the Manifest.

Alias certificates store `pinned: false` and `expiresAt` = certify time + 30 days. After expiry, `why` is `uncertified`. If a dated catalog lists a dated id, autonomy requires the decider to use it.

## Certificates

Lockfile version 2: `{ version: 2, decisions: { [name]: { deciders: { [decider]: { model, pinned, expiresAt?, certifiedAt?, questions } } } } }`.

Version 1 throws a message to recertify. A runtime model mismatch, missing cert, hash mismatch, locale mismatch, or alias expiry is `why: "uncertified"`. Switching to a decider that already has a certificate needs no recertification.

`oke decide certify <name> --deciders a,b` writes one certificate per decider. `oke decide promote` and `oke decide labels` stay. `oke decide models` lists catalog id, canonical slug, context, and input modalities. `oke eval --certify` is removed.

`drivers.decide` defaults to `{ test: "mock" }`. Unset dev and prod call the host. `t.ai.decide(decision, answers)` scripts probabilities or `{ refusal }`. The refusal string is not stored.

## Console and MCP

Console resolves reviews. MCP stays read-only and includes `by`, `why`, and per-decider certificates. There is no resolve or promote tool.
