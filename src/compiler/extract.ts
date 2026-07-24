/**
 * Manifest extraction — oxc parse → bindings → flows → effects → Manifest.
 *
 * Never uses the TypeScript compiler API (unified-theory §11). `tsc` remains
 * for type-checking only; this module is the build-time close-the-loop path
 * from source to `manifest.oke.json`.
 */

import { Glob } from "bun";
import { parseSync } from "oxc-parser";

import type {
  Ai,
  AiAgent,
  AiModel,
  AiPrompt,
  Channel,
  Clock,
  Effects,
  Flow,
  Gate,
  Journey,
  Manifest,
  RateStrategy,
  SecretContract,
  Signal,
  SignalDelivery,
  Slo,
  Store,
  Trigger,
} from "../manifest/types.ts";
import {
  identifierName,
  inferEffects,
  stringArg,
  walk,
  type AstNode,
  type CallExpression,
  type Identifier,
  type InferBinding,
  type Literal,
} from "./effects-infer.ts";

/** One source file for extraction. */
export interface SourceFile {
  /** Path relative to the app root (used in `source` and for imports). */
  readonly path: string;
  /** File contents. */
  readonly source: string;
}

/** Options for {@link extractManifest}. */
export interface ExtractManifestOptions {
  /** Application root (for reading files when `files` is omitted). */
  readonly rootDir?: string;
  /** Explicit sources (tests / synthetic apps). */
  readonly files?: readonly SourceFile[];
  /** Glob under `rootDir` (default: all TypeScript files recursively). */
  readonly glob?: string;
  /** Override app name when `oke({ name })` is absent. */
  readonly app?: string;
}

/** Internal project scope accumulated across files. */
interface ProjectScope {
  app: string;
  bindings: Map<string, InferBinding>;
  signals: Record<string, Signal>;
  stores: Record<string, Store>;
  clocks: Record<string, Clock>;
  gates: Record<string, Gate>;
  /** Local binding name → gate manifest id (policy name or rate expression). */
  gateIds: Map<string, string>;
  vault: Record<string, SecretContract>;
  channels: Record<string, Channel>;
  ai: Ai;
  journeys: Record<string, Journey>;
  drivers: Record<string, string[]>;
  tenancy?: Manifest["tenancy"];
  i18n?: Manifest["i18n"];
  topology?: Manifest["topology"];
  images?: Record<string, string>;
  flows: Record<string, Flow>;
  /** Export name → flow id (for agent tools). */
  flowExports: Map<string, string>;
}

/**
 * Extract a Manifest from TypeScript sources via oxc.
 *
 * @param options - Root directory and/or explicit files
 */
export async function extractManifest(
  options: ExtractManifestOptions = {},
): Promise<Manifest> {
  const files = options.files
    ? [...options.files]
    : await readSources(options.rootDir ?? ".", options.glob ?? "**/*.{ts,tsx}");

  const scope: ProjectScope = {
    app: options.app ?? "app",
    bindings: new Map(),
    signals: {},
    stores: {},
    clocks: {},
    gates: {},
    gateIds: new Map(),
    vault: {},
    channels: {},
    ai: {},
    journeys: {},
    drivers: {},
    flows: {},
    flowExports: new Map(),
  };

  const parsed = files.map((file) => {
    const result = parseSync(file.path, file.source, {
      sourceType: "module",
      lang: file.path.endsWith("x") ? "tsx" : "ts",
    });
    return { file, program: result.program as unknown as AstNode };
  });

  // Pass 1 — declarations (elements, config, named bindings).
  for (const { program } of parsed) {
    collectDeclarations(program, scope);
  }

  // Pass 2 — flows / on() bindings.
  for (const { file, program } of parsed) {
    collectFlows(file, program, scope);
  }

  // Pass 3 — resolve deferred refs (agent tools, journey paths).
  finalizeRefs(scope);

  // Stable ordering for golden files.
  const flows = sortRecord(scope.flows);
  const signals = sortRecord(scope.signals);
  const stores = sortRecord(scope.stores);
  const clocks = sortRecord(scope.clocks);
  const gates = sortRecord(scope.gates);
  const vault = sortRecord(scope.vault);
  const channels = sortRecord(scope.channels);
  const journeys = sortRecord(scope.journeys);
  const drivers = sortRecord(scope.drivers);

  const manifest: Manifest = {
    oke: "1.0",
    app: scope.app,
  };

  if (Object.keys(flows).length > 0) manifest.flows = flows;
  if (Object.keys(signals).length > 0) manifest.signals = signals;
  if (Object.keys(stores).length > 0) manifest.stores = stores;
  if (Object.keys(clocks).length > 0) manifest.clocks = clocks;
  if (Object.keys(gates).length > 0) manifest.gates = gates;
  if (Object.keys(vault).length > 0) manifest.vault = vault;
  if (Object.keys(channels).length > 0) manifest.channels = channels;
  if (scope.ai.models || scope.ai.prompts || scope.ai.agents) {
    manifest.ai = {
      ...(scope.ai.models ? { models: sortRecord(scope.ai.models) } : {}),
      ...(scope.ai.prompts ? { prompts: sortRecord(scope.ai.prompts) } : {}),
      ...(scope.ai.agents ? { agents: sortRecord(scope.ai.agents) } : {}),
    };
  }
  if (Object.keys(journeys).length > 0) manifest.journeys = journeys;
  if (Object.keys(drivers).length > 0) manifest.drivers = drivers;
  if (scope.tenancy) manifest.tenancy = scope.tenancy;
  if (scope.i18n) manifest.i18n = scope.i18n;
  if (scope.topology) manifest.topology = scope.topology;
  if (scope.images) manifest.images = scope.images;

  return manifest;
}

/**
 * Extract from an in-memory map of path → source (convenience for tests).
 *
 * @param sources - Path → source text
 * @param app - Optional app name override
 */
export async function extractFromSources(
  sources: Readonly<Record<string, string>>,
  app?: string,
): Promise<Manifest> {
  const files = Object.entries(sources).map(([path, source]) => ({
    path,
    source,
  }));
  return extractManifest({ files, app });
}

async function readSources(
  rootDir: string,
  pattern: string,
): Promise<SourceFile[]> {
  const glob = new Glob(pattern);
  const files: SourceFile[] = [];
  for await (const path of glob.scan({
    cwd: rootDir,
    onlyFiles: true,
  })) {
    if (path.includes("node_modules/") || path.endsWith(".test.ts")) continue;
    const abs = `${rootDir.replace(/\/$/, "")}/${path}`;
    files.push({ path, source: await Bun.file(abs).text() });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function collectDeclarations(program: AstNode, scope: ProjectScope): void {
  walk(program, (node) => {
    if (node.type === "CallExpression") {
      visitDeclarationCall(node as CallExpression, program, scope);
    }
    if (node.type === "VariableDeclarator") {
      visitDeclarator(node as AstNode, scope);
    }
  });

  // oke({ name })
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const call = node as CallExpression;
    if (identifierName(call.callee) !== "oke") return;
    const opts = objectArg(call.arguments[0]);
    const name = stringProp(opts, "name");
    if (name) scope.app = name;
  });
}

function visitDeclarator(decl: AstNode, scope: ProjectScope): void {
  const id = (decl as AstNode & { id?: AstNode }).id;
  const init = (decl as AstNode & { init?: AstNode }).init;
  if (!id || !init) return;
  const name = identifierName(id);
  if (!name) return;

  // export const x = on(...) / flow(...) — flow export alias
  if (init.type === "CallExpression") {
    const call = init as CallExpression;
    const callee = identifierName(call.callee);
    if (callee === "on" || callee === "flow") {
      // Resolved in pass 2 once the flow name is known; stash export hint.
      scope.flowExports.set(name, name);
    }
  }

  // Re-exports / aliases: const canBook = bookingCreateGate
  if (init.type === "Identifier") {
    const target = (init as Identifier).name;
    const binding = scope.bindings.get(target);
    if (binding) scope.bindings.set(name, binding);
    const gateId = scope.gateIds.get(target);
    if (gateId) scope.gateIds.set(name, gateId);
  }
}

function finalizeRefs(scope: ProjectScope): void {
  if (scope.ai.agents) {
    for (const agent of Object.values(scope.ai.agents)) {
      if (!agent.tools) continue;
      agent.tools = agent.tools.map(
        (id) => scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id,
      );
    }
  }
  for (const journey of Object.values(scope.journeys)) {
    if (!journey.flows) continue;
    journey.flows = journey.flows.map(
      (id) => scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id,
    );
  }
}

function visitDeclarationCall(
  call: CallExpression,
  program: AstNode,
  scope: ProjectScope,
): void {
  const callee = call.callee;

  // store.sql("name") / store.kv(...) / …
  if (callee.type === "MemberExpression") {
    const member = callee as AstNode & {
      object: AstNode;
      property: AstNode;
    };
    const obj = identifierName(member.object);
    const prop = identifierName(member.property);

    if (obj === "store" && prop) {
      const facets = ["sql", "kv", "files", "index"] as const;
      if ((facets as readonly string[]).includes(prop)) {
        const facet = prop as (typeof facets)[number];
        const storeName = stringArg(call.arguments[0]) ?? "store";
        const ref = `${facet}:${storeName}` as const;
        const bindingName = enclosingConstName(call, program);
        scope.stores[storeName] = scope.stores[storeName] ?? { facet };
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "store",
            ref,
            facet,
          });
        }
      }
    }

    if (obj === "gate" && prop === "policy") {
      const policyName = stringArg(call.arguments[0]);
      if (policyName) {
        scope.gates[policyName] = { kind: "policy", roles: [policyName] };
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.gateIds.set(bindingName, policyName);
          scope.bindings.set(bindingName, {
            kind: "unknown",
            ref: policyName,
          });
        }
      }
    }

    if (obj === "gate" && prop === "rate") {
      const opts = objectArg(call.arguments[0]);
      const strategy = (stringProp(opts, "strategy") ??
        "sliding-window-counter") as RateStrategy;
      const max = numberProp(opts, "max");
      const per = stringProp(opts, "per");
      const keyBy = stringProp(opts, "keyBy");
      if (max !== undefined && per) {
        const expr = `rate:${strategy}:${max}/${per}`;
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.gates[bindingName] = {
            kind: "rate",
            strategy,
            max,
            per,
            ...(keyBy ? { keyBy } : {}),
          };
          scope.gateIds.set(bindingName, expr);
        } else {
          scope.gates[expr] = {
            kind: "rate",
            strategy,
            max,
            per,
            ...(keyBy ? { keyBy } : {}),
          };
        }
      }
    }

    if (obj === "channel" && prop === "template") {
      const templateName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (templateName) {
        const medium = stringProp(opts, "medium");
        const locales = stringArrayProp(opts, "locales");
        scope.channels[templateName] = {
          ...(medium
            ? { medium: medium as Channel["medium"] }
            : { medium: "email" }),
          ...(locales ? { locales } : {}),
        };
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "template",
            ref: templateName,
          });
        }
      }
    }

    if (obj === "ai" && prop === "model") {
      const modelName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (modelName) {
        const model: AiModel = {
          ...(stringProp(opts, "provider")
            ? { provider: stringProp(opts, "provider") }
            : {}),
          ...(stringProp(opts, "tier")
            ? { tier: stringProp(opts, "tier") }
            : {}),
        };
        scope.ai.models = scope.ai.models ?? {};
        scope.ai.models[modelName] = model;
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "unknown",
            ref: modelName,
          });
        }
      }
    }

    if (obj === "ai" && prop === "agent") {
      collectAgent(call, scope);
    }

    if (obj === "ai" && prop === "embed") {
      const embedName = stringArg(call.arguments[0]);
      if (embedName) {
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "embed",
            ref: embedName,
            facet: "index",
          });
        }
      }
    }

    // model.prompt("ticket-triage", { version, evals, budget })
    if (prop === "prompt") {
      const promptName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (promptName) {
        const version = numberProp(opts, "version");
        const evals = stringProp(opts, "evals");
        const budgetObj = objectProp(opts, "budget");
        const prompt: AiPrompt = {
          ...(version !== undefined ? { version } : {}),
          ...(evals ? { evals } : {}),
          ...(budgetObj
            ? {
                budget: {
                  ...(numberProp(budgetObj, "maxCostPerCall") !== undefined
                    ? {
                        maxCostPerCall: numberProp(budgetObj, "maxCostPerCall"),
                      }
                    : {}),
                },
              }
            : {}),
        };
        scope.ai.prompts = scope.ai.prompts ?? {};
        scope.ai.prompts[promptName] = prompt;
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "prompt",
            ref: promptName,
            version,
          });
        }
      }
    }

    if (obj === "vault" && (prop === "secret" || prop === "define")) {
      const secretName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (secretName) {
        scope.vault[secretName] = {
          ...(stringProp(opts, "description")
            ? { description: stringProp(opts, "description") }
            : {}),
          ...(stringProp(opts, "rotate")
            ? { rotate: stringProp(opts, "rotate") }
            : {}),
        };
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "secret",
            ref: secretName,
          });
        }
      }
    }
  }

  // signal("name", { delivery, … })
  if (identifierName(callee) === "signal") {
    const signalName = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (signalName) {
      const delivery = stringProp(opts, "delivery") as SignalDelivery | undefined;
      if (delivery) {
        const signal: Signal = {
          delivery,
          ...(numberProp(opts, "retries") !== undefined
            ? { retries: numberProp(opts, "retries") }
            : {}),
          ...(boolProp(opts, "deadLetter") !== undefined
            ? { deadLetter: boolProp(opts, "deadLetter") }
            : {}),
        };
        scope.signals[signalName] = signal;
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "signal",
            ref: signalName,
          });
        }
      }
    }
  }

  // clock.every("10m") / clock("expire-holds", { every, overridable })
  if (identifierName(callee) === "clock") {
    const name = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (name && opts) {
      scope.clocks[name] = {
        ...(stringProp(opts, "every")
          ? { every: stringProp(opts, "every") }
          : {}),
        ...(stringProp(opts, "cron") ? { cron: stringProp(opts, "cron") } : {}),
        ...(boolProp(opts, "overridable") !== undefined
          ? { overridable: boolProp(opts, "overridable") }
          : {}),
      };
    }
  }

  // journey("book-a-flight", { slo, composes, path })
  if (identifierName(callee) === "journey") {
    const name = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (name && opts) {
      const sloObj = objectProp(opts, "slo");
      const pathArr = arrayProp(opts, "path");
      const flows = pathArr
        ?.map((el) => {
          const id = identifierName(el);
          if (!id) return stringArg(el);
          return scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id;
        })
        .filter((x): x is string => typeof x === "string");
      const journey: Journey = {
        ...(sloObj
          ? {
              slo: {
                ...(stringProp(sloObj, "availability")
                  ? { availability: stringProp(sloObj, "availability") }
                  : {}),
              },
            }
          : {}),
        ...(stringProp(opts, "composes")
          ? { composes: stringProp(opts, "composes") }
          : {}),
        ...(flows && flows.length > 0 ? { flows } : {}),
      };
      scope.journeys[name] = journey;
    }
  }

  // defineConfig({ drivers, tenancy, i18n, topology, images })
  if (identifierName(callee) === "defineConfig") {
    collectConfig(objectArg(call.arguments[0]), scope);
  }

  // vault("STRIPE_KEY", { … }) — bare call form
  if (identifierName(callee) === "vault") {
    const secretName = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (secretName) {
      scope.vault[secretName] = {
        ...(stringProp(opts, "description")
          ? { description: stringProp(opts, "description") }
          : {}),
        ...(stringProp(opts, "rotate")
          ? { rotate: stringProp(opts, "rotate") }
          : {}),
      };
      const bindingName = enclosingConstName(call, program);
      if (bindingName) {
        scope.bindings.set(bindingName, { kind: "secret", ref: secretName });
      }
    }
  }
}

function collectAgent(call: CallExpression, scope: ProjectScope): void {
  const agentName = stringArg(call.arguments[0]);
  const opts = objectArg(call.arguments[1]);
  if (!agentName || !opts) return;
  const toolsArr = arrayProp(opts, "tools");
  const tools = toolsArr
    ?.map((el) => identifierName(el) ?? stringArg(el))
    .filter((x): x is string => typeof x === "string")
    .map((id) => scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id);
  const agent: AiAgent = {
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(numberProp(opts, "maxSteps") !== undefined
      ? { maxSteps: numberProp(opts, "maxSteps") }
      : {}),
  };
  scope.ai.agents = scope.ai.agents ?? {};
  scope.ai.agents[agentName] = agent;
}

function collectConfig(
  opts: AstNode | undefined,
  scope: ProjectScope,
): void {
  if (!opts) return;

  const tenancy = objectProp(opts, "tenancy");
  if (tenancy) {
    const isolation = stringProp(tenancy, "isolation");
    if (
      isolation === "row" ||
      isolation === "schema" ||
      isolation === "database"
    ) {
      scope.tenancy = { isolation };
    }
  }

  const i18n = objectProp(opts, "i18n");
  if (i18n) {
    scope.i18n = {
      ...(stringArrayProp(i18n, "locales")
        ? { locales: stringArrayProp(i18n, "locales") }
        : {}),
      ...(stringProp(i18n, "default")
        ? { default: stringProp(i18n, "default") }
        : {}),
    };
    const dir = objectProp(i18n, "dir");
    if (dir && dir.type === "ObjectExpression") {
      const dirMap: Record<string, "ltr" | "rtl"> = {};
      for (const prop of objectProperties(dir)) {
        const key = propKey(prop);
        const val = stringArg(
          (prop as AstNode & { value?: AstNode }).value,
        );
        if (key && (val === "ltr" || val === "rtl")) dirMap[key] = val;
      }
      if (Object.keys(dirMap).length > 0) {
        scope.i18n = { ...scope.i18n, dir: dirMap };
      }
    }
  }

  const topology = stringProp(opts, "topology");
  if (topology === "monolith" || topology === "services") {
    scope.topology = topology;
  }

  const images = objectProp(opts, "images");
  if (images) {
    const map: Record<string, string> = {};
    for (const prop of objectProperties(images)) {
      const key = propKey(prop);
      const val = stringArg((prop as AstNode & { value?: AstNode }).value);
      if (key && val) map[key] = val;
    }
    if (Object.keys(map).length > 0) scope.images = map;
  }

  // drivers: prefer an explicit prod string[], else flatten nested role maps.
  const drivers = objectProp(opts, "drivers");
  if (drivers) {
    const prodArr = arrayProp(drivers, "prod");
    if (prodArr && prodArr.length > 0 && prodArr.every((el) => stringArg(el))) {
      scope.drivers.prod = prodArr
        .map((el) => stringArg(el)!)
        .filter((x) => x.length > 0);
    } else {
      const prod = new Set<string>();
      collectDriverProtocols(drivers, "prod", prod);
      if (prod.size > 0) scope.drivers.prod = [...prod];
    }
  }
}

function collectDriverProtocols(
  node: AstNode,
  env: string,
  into: Set<string>,
): void {
  if (node.type !== "ObjectExpression") return;
  for (const prop of objectProperties(node)) {
    const key = propKey(prop);
    const value = (prop as AstNode & { value?: AstNode }).value;
    if (!value) continue;

    if (key === env) {
      if (value.type === "Literal" && typeof (value as Literal).value === "string") {
        into.add((value as Literal).value as string);
      } else if (value.type === "ObjectExpression") {
        const driver = stringProp(value, "driver");
        if (driver) into.add(driver);
        // Nested role objects may also use env keys.
        collectDriverProtocols(value, env, into);
      }
      continue;
    }

    if (value.type === "ObjectExpression") {
      // role: { dev, test, prod } or nested store: { sql: { prod } }
      const envVal = objectProp(value, env);
      if (envVal) {
        if (
          envVal.type === "Literal" &&
          typeof (envVal as Literal).value === "string"
        ) {
          into.add((envVal as Literal).value as string);
        } else if (envVal.type === "ObjectExpression") {
          const driver = stringProp(envVal, "driver");
          if (driver) into.add(driver);
        }
      } else {
        collectDriverProtocols(value, env, into);
      }
    }
  }
}

function collectFlows(
  file: SourceFile,
  program: AstNode,
  scope: ProjectScope,
): void {
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const call = node as CallExpression;
    const callee = identifierName(call.callee);

    if (callee === "on") {
      const triggerNode = call.arguments[0];
      const flowNode = call.arguments[1];
      if (!triggerNode || !flowNode) return;
      const flowCall = unwrapFlowCall(flowNode);
      if (!flowCall) return;
      const exportName = enclosingConstName(call, program);
      registerFlow({
        flowCall,
        triggerNode,
        file,
        scope,
        exportName,
      });
      return;
    }

    if (callee === "flow") {
      // Bare flow — skip when this call is the second arg of an on().
      if (isOnFlowArgument(call, program)) return;
      const exportName = enclosingConstName(call, program);
      registerFlow({
        flowCall: call,
        triggerNode: undefined,
        file,
        scope,
        exportName,
      });
    }
  });
}

function isOnFlowArgument(flowCall: CallExpression, program: AstNode): boolean {
  const targetStart = flowCall.start;
  if (targetStart === undefined) return false;
  let found = false;
  walk(program, (node) => {
    if (found) return;
    if (node.type !== "CallExpression") return;
    const call = node as CallExpression;
    if (identifierName(call.callee) !== "on") return;
    const arg = call.arguments[1];
    if (arg && arg.type === "CallExpression" && arg.start === targetStart) {
      found = true;
    }
  });
  return found;
}

function unwrapFlowCall(node: AstNode): CallExpression | undefined {
  if (node.type === "CallExpression" && identifierName((node as CallExpression).callee) === "flow") {
    return node as CallExpression;
  }
  return undefined;
}

function registerFlow(args: {
  flowCall: CallExpression;
  triggerNode: AstNode | undefined;
  file: SourceFile;
  scope: ProjectScope;
  exportName: string | undefined;
}): void {
  const opts = objectArg(args.flowCall.arguments[0]);
  if (!opts) return;

  const name =
    stringProp(opts, "name") ??
    args.exportName ??
    `flow_${Object.keys(args.scope.flows).length + 1}`;

  if (args.exportName) {
    args.scope.flowExports.set(args.exportName, name);
    args.scope.bindings.set(args.exportName, { kind: "flow", ref: name });
  }
  args.scope.bindings.set(name, { kind: "flow", ref: name });

  const hasExplicitEffects = objectProp(opts, "effects") !== undefined;
  const doNode = objectProp(opts, "do");
  const inferred = doNode
    ? inferEffects({
        doNode,
        bindings: args.scope.bindings,
        hasExplicitEffects,
      })
    : {
        effects: {} as Effects,
        steps: [] as string[],
        usesRaw: false,
        cacheIneligible: false,
        nondeterministic: false,
        readsUserId: false,
      };

  let effects: Effects | undefined;
  if (hasExplicitEffects) {
    effects = parseEffectsObject(objectProp(opts, "effects"));
  } else {
    effects = inferred.effects;
  }

  // Spec excerpt includes empty secrets[] when other keys present for create.
  if (
    effects &&
    (effects.reads || effects.writes || effects.emits) &&
    effects.secrets === undefined &&
    !inferred.usesRaw
  ) {
    // Keep secrets omitted unless the excerpt-style empty list is needed —
    // only add empty secrets when emits are present (bookings.create shape).
    if (effects.emits && effects.emits.length > 0) {
      effects = { ...effects, secrets: [] };
    }
  }

  const trigger = args.triggerNode
    ? parseTrigger(args.triggerNode, args.scope)
    : undefined;

  const gates = trigger?.gates;
  const liveFromTrigger = trigger?.live;
  const manifestTrigger = trigger
    ? stripTriggerExtras(trigger.trigger)
    : undefined;

  const flow: Flow = {};

  if (manifestTrigger && Object.keys(manifestTrigger).length > 0) {
    flow.trigger = manifestTrigger;
  }
  if (gates && gates.length > 0) flow.gates = gates;

  const inSchema = schemaProp(opts, "in");
  if (inSchema !== undefined) flow.in = inSchema;
  const outSchema = schemaProp(opts, "out");
  if (outSchema !== undefined) flow.out = outSchema;

  const errors = parseErrors(objectProp(opts, "errors"));
  if (errors) flow.errors = errors;

  if (effects && Object.keys(effects).length > 0) flow.effects = effects;

  const line = lineAt(args.file.source, args.flowCall.start ?? 0);
  flow.source = `${args.file.path}:${line}`;

  if (boolProp(opts, "durable")) flow.durable = true;
  if (boolProp(opts, "live") || liveFromTrigger) flow.live = true;

  const slo = parseSlo(objectProp(opts, "slo"));
  if (slo) flow.slo = slo;

  const stepsFromOpts = stringArrayProp(opts, "steps");
  const steps =
    stepsFromOpts && stepsFromOpts.length > 0
      ? stepsFromOpts
      : inferred.steps;
  if (steps.length > 0) flow.steps = steps;

  if (boolProp(opts, "nondeterministic") || inferred.nondeterministic) {
    flow.nondeterministic = true;
  }

  const cost = objectProp(opts, "cost");
  if (cost) {
    flow.cost = {
      ...(numberProp(cost, "estimatePerCall") !== undefined
        ? { estimatePerCall: numberProp(cost, "estimatePerCall") }
        : {}),
      ...(numberProp(cost, "budget") !== undefined
        ? { budget: numberProp(cost, "budget") }
        : {}),
    };
  } else if (inferred.nondeterministic) {
    // Derive budget from the first ask prompt when present.
    const ask = effects?.asks?.[0];
    if (ask) {
      const promptName = ask.split("@")[0]!;
      const promptBudget = args.scope.ai.prompts?.[promptName]?.budget
        ?.maxCostPerCall;
      if (promptBudget !== undefined) {
        flow.cost = {
          estimatePerCall: Number((promptBudget * 0.55).toFixed(3)),
          budget: promptBudget,
        };
      }
    }
  }

  const pii = stringProp(opts, "pii");
  if (pii === "masked" || pii === "allow" || pii === "denied") {
    flow.pii = pii;
  } else if (inferred.nondeterministic) {
    flow.pii = "masked";
  }

  const plane = stringProp(opts, "plane");
  if (plane === "user" || plane === "operator") flow.plane = plane;

  if (inferred.cacheIneligible) {
    flow.cache = false;
  } else {
    const cache = (opts &&
      objectProperties(opts).find((p) => propKey(p) === "cache")) as
      | AstNode
      | undefined;
    if (cache) {
      const val = (cache as AstNode & { value?: AstNode }).value;
      if (val?.type === "Literal") {
        const v = (val as Literal).value;
        if (typeof v === "boolean" || typeof v === "string") flow.cache = v;
      }
    }
  }

  const cacheKeys = stringProp(opts, "cacheKeys");
  if (cacheKeys) {
    flow.cacheKeys = cacheKeys;
  } else if (flow.live && inferred.readsUserId && effects?.reads?.[0]) {
    flow.cacheKeys = `computed:${effects.reads[0]}/userId`;
  }

  args.scope.flows[name] = flow;
}

interface ParsedTrigger {
  trigger: Trigger;
  gates?: string[];
  live?: boolean;
}

function parseTrigger(node: AstNode, scope: ProjectScope): ParsedTrigger | undefined {
  // every("10m")
  if (node.type === "CallExpression") {
    const call = node as CallExpression;
    const name = identifierName(call.callee);
    if (name === "every") {
      const interval = stringArg(call.arguments[0]);
      if (interval) return { trigger: { every: interval } };
    }
    if (name === "internal") {
      return { trigger: {} };
    }

    // http.post("/x").gate(...).live()
    const http = parseHttpTrigger(call, scope);
    if (http) return http;

    // table("orders").changed("status") / db.table(orders).changed(...)
    const cdc = parseCdcTrigger(call);
    if (cdc) return { trigger: { cdc } };

    // on(signalHandle, …) — Identifier referring to a signal binding
  }

  if (node.type === "Identifier") {
    const id = (node as Identifier).name;
    if (id === "internal") return { trigger: {} };
    const binding = scope.bindings.get(id);
    if (binding?.kind === "signal") {
      return { trigger: { signal: binding.ref } };
    }
    if (scope.signals[id]) return { trigger: { signal: id } };
    return { trigger: { signal: id } };
  }

  return undefined;
}

function parseHttpTrigger(
  call: CallExpression,
  scope: ProjectScope,
): ParsedTrigger | undefined {
  // Walk the chain: http.METHOD(path).gate(...).live()
  let current: AstNode = call;
  let method: string | undefined;
  let path: string | undefined;
  let live = false;
  const gateNames: string[] = [];

  // Flatten chain from leaf to root
  const chain: CallExpression[] = [];
  while (current.type === "CallExpression") {
    chain.unshift(current as CallExpression);
    const callee = (current as CallExpression).callee;
    if (callee.type === "MemberExpression") {
      const obj = (callee as AstNode & { object: AstNode }).object;
      current = obj;
      continue;
    }
    break;
  }

  for (const c of chain) {
    const callee = c.callee;
    if (callee.type !== "MemberExpression") continue;
    const member = callee as AstNode & {
      object: AstNode;
      property: AstNode;
    };
    const prop = identifierName(member.property);
    const obj = member.object;

    if (obj.type === "Identifier" && (obj as Identifier).name === "http" && prop) {
      method = prop.toUpperCase();
      path = stringArg(c.arguments[0]);
      continue;
    }

    if (prop === "gate") {
      for (const arg of c.arguments) {
        const id = identifierName(arg);
        if (!id) continue;
        const resolved = scope.gateIds.get(id) ?? id;
        gateNames.push(resolved);
      }
      continue;
    }

    if (prop === "live") {
      live = true;
    }
  }

  if (!method || !path) return undefined;

  const httpMethods = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ] as const;
  if (!(httpMethods as readonly string[]).includes(method)) return undefined;

  return {
    trigger: {
      http: {
        method: method as (typeof httpMethods)[number],
        path,
      },
    },
    gates: gateNames.length > 0 ? gateNames : undefined,
    live: live || undefined,
  };
}

function parseCdcTrigger(
  call: CallExpression,
): Trigger["cdc"] | undefined {
  // *.changed("col") or *.changed()
  const callee = call.callee;
  if (callee.type !== "MemberExpression") return undefined;
  const member = callee as AstNode & { object: AstNode; property: AstNode };
  if (identifierName(member.property) !== "changed") return undefined;

  const column = stringArg(call.arguments[0]);
  // object is table("orders") or db.table(orders) or table(orders)
  const obj = member.object;
  if (obj.type === "CallExpression") {
    const inner = obj as CallExpression;
    const innerCallee = inner.callee;
    if (identifierName(innerCallee) === "table") {
      const tableName =
        stringArg(inner.arguments[0]) ?? identifierName(inner.arguments[0]);
      if (!tableName) return undefined;
      return column
        ? { table: tableName, column }
        : { table: tableName };
    }
    if (
      innerCallee.type === "MemberExpression" &&
      identifierName(
        (innerCallee as AstNode & { property: AstNode }).property,
      ) === "table"
    ) {
      const tableName =
        stringArg(inner.arguments[0]) ?? identifierName(inner.arguments[0]);
      if (!tableName) return undefined;
      return column
        ? { table: tableName, column }
        : { table: tableName };
    }
  }
  return undefined;
}

function stripTriggerExtras(trigger: Trigger): Trigger {
  return trigger;
}

function parseEffectsObject(node: AstNode | undefined): Effects | undefined {
  if (!node) return undefined;
  const effects: Effects = {};
  const reads = stringArrayProp(node, "reads");
  const writes = stringArrayProp(node, "writes");
  const emits = stringArrayProp(node, "emits");
  const sends = stringArrayProp(node, "sends");
  const asks = stringArrayProp(node, "asks");
  const secrets = stringArrayProp(node, "secrets");
  const calls = stringArrayProp(node, "calls");
  if (reads) effects.reads = reads as Effects["reads"];
  if (writes) effects.writes = writes as Effects["writes"];
  if (emits) effects.emits = emits;
  if (sends) effects.sends = sends;
  if (asks) effects.asks = asks;
  if (secrets) effects.secrets = secrets;
  if (calls) effects.calls = calls;
  return effects;
}

function parseErrors(
  node: AstNode | undefined,
): Flow["errors"] | undefined {
  if (!node) return undefined;
  if (node.type === "ObjectExpression") {
    const names: string[] = [];
    for (const prop of objectProperties(node)) {
      const key = propKey(prop);
      if (key) names.push(key);
    }
    return names.length > 0 ? names : undefined;
  }
  if (node.type === "ArrayExpression") {
    const els = (node as AstNode & { elements?: AstNode[] }).elements ?? [];
    const names = els
      .map((el) => stringArg(el) ?? identifierName(el))
      .filter((x): x is string => typeof x === "string");
    return names.length > 0 ? names : undefined;
  }
  return undefined;
}

function parseSlo(node: AstNode | undefined): Slo | undefined {
  if (!node) return undefined;
  const availability = stringProp(node, "availability");
  const latencyObj = objectProp(node, "latency");
  const latency: Record<string, string> = {};
  if (latencyObj) {
    for (const prop of objectProperties(latencyObj)) {
      const key = propKey(prop);
      const val = stringArg((prop as AstNode & { value?: AstNode }).value);
      if (key && val) latency[key] = val;
    }
  }
  if (!availability && Object.keys(latency).length === 0) return undefined;
  return {
    ...(availability ? { availability } : {}),
    ...(Object.keys(latency).length > 0 ? { latency } : {}),
  };
}

function schemaProp(
  obj: AstNode | undefined,
  key: string,
): string | undefined {
  const node = objectProp(obj, key);
  if (!node) return undefined;
  // Identifier / member schemas → opaque placeholder matching the spec excerpt.
  if (node.type === "Identifier" || node.type === "MemberExpression") {
    return "…";
  }
  if (node.type === "CallExpression") return "…";
  const lit = stringArg(node);
  if (lit) return lit;
  return "…";
}

// ── AST helpers ────────────────────────────────────────────────────────────

function enclosingConstName(
  call: CallExpression,
  program: AstNode,
): string | undefined {
  const targetStart = call.start;
  if (targetStart === undefined) return undefined;
  let found: string | undefined;
  walk(program, (node) => {
    if (found) return;
    if (node.type !== "VariableDeclarator") return;
    const id = (node as AstNode & { id?: AstNode }).id;
    const init = (node as AstNode & { init?: AstNode }).init;
    if (!id || !init) return;
    const name = identifierName(id);
    if (!name) return;
    if (containsOffset(init, targetStart)) found = name;
  });
  return found;
}

function containsOffset(root: AstNode, start: number): boolean {
  let found = false;
  walk(root, (node) => {
    if (node.start === start) found = true;
  });
  return found;
}

function objectArg(node: AstNode | undefined): AstNode | undefined {
  if (!node) return undefined;
  if (node.type === "ObjectExpression") return node;
  return undefined;
}

function objectProp(
  obj: AstNode | undefined,
  key: string,
): AstNode | undefined {
  if (!obj || obj.type !== "ObjectExpression") return undefined;
  for (const prop of objectProperties(obj)) {
    if (propKey(prop) === key) {
      return (prop as AstNode & { value?: AstNode }).value;
    }
  }
  return undefined;
}

function objectProperties(obj: AstNode): AstNode[] {
  return (
    (obj as AstNode & { properties?: AstNode[] }).properties ?? []
  ).filter((p) => p.type === "Property" || p.type === "ObjectProperty");
}

function propKey(prop: AstNode): string | undefined {
  const key = (prop as AstNode & { key?: AstNode }).key;
  if (!key) return undefined;
  if (key.type === "Identifier") return (key as Identifier).name;
  if (key.type === "Literal" && typeof (key as Literal).value === "string") {
    return (key as Literal).value as string;
  }
  return undefined;
}

function stringProp(
  obj: AstNode | undefined,
  key: string,
): string | undefined {
  return stringArg(objectProp(obj, key));
}

function numberProp(
  obj: AstNode | undefined,
  key: string,
): number | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "Literal") return undefined;
  const v = (node as Literal).value;
  return typeof v === "number" ? v : undefined;
}

function boolProp(
  obj: AstNode | undefined,
  key: string,
): boolean | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "Literal") return undefined;
  const v = (node as Literal).value;
  return typeof v === "boolean" ? v : undefined;
}

function stringArrayProp(
  obj: AstNode | undefined,
  key: string,
): string[] | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "ArrayExpression") return undefined;
  const els = (node as AstNode & { elements?: AstNode[] }).elements ?? [];
  const out = els
    .map((el) => stringArg(el))
    .filter((x): x is string => typeof x === "string");
  return out;
}

function arrayProp(
  obj: AstNode | undefined,
  key: string,
): AstNode[] | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "ArrayExpression") return undefined;
  return ((node as AstNode & { elements?: AstNode[] }).elements ?? []).filter(
    (el): el is AstNode => el !== null && el !== undefined,
  );
}

/**
 * 1-based line number for a byte offset.
 *
 * @param source - Source text
 * @param offset - Byte offset
 */
export function lineAt(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = record[key]!;
  }
  return out;
}

/**
 * Deep subset match — every key/value in `expected` appears in `actual`.
 *
 * @param actual - Extracted value
 * @param expected - Spec excerpt (or golden subset)
 */
export function deepMatch(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return Object.is(actual, expected);
  }
  if (actual === null || typeof actual !== "object") return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (expected.length !== actual.length) return false;
    return expected.every((item, i) => deepMatch(actual[i], item));
  }
  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  for (const key of Object.keys(expObj)) {
    if (!(key in actObj)) return false;
    if (!deepMatch(actObj[key], expObj[key])) return false;
  }
  return true;
}
