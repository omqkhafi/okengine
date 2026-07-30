/**
 * Console UI client — `createClient` against the ConsoleApp on :6533.
 */

import { createClient } from "../../../client/create.ts";

/** Session tokens held in memory (cookies are HttpOnly / SameSite=Strict). */
let accessToken: string | null = null;

/**
 * Store the operator access token after claim/login.
 *
 * @param token - Access token or null to clear
 */
export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) {
    sessionStorage.setItem("oke_console_at", token);
  } else {
    sessionStorage.removeItem("oke_console_at");
  }
}

/**
 * Restore token from sessionStorage (tab lifetime).
 */
export function restoreAccessToken(): void {
  accessToken = sessionStorage.getItem("oke_console_at");
}

/** Loose result shape from Console REST calls. */
type CallResult<T> = Promise<{
  data: T | null;
  error: { code: string } | null;
}>;

/** Access key row (client). */
type AccessKeyClient = {
  id: string;
  name: string;
  plane: "user" | "operator";
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  rateLimit: { max: number; per: string } | null;
  ipAllowlist: string[];
  unused90d: boolean;
};

/** Access operator row (client). */
type AccessOperatorClient = {
  id: string;
  email: string;
  name: string;
  status: "active" | "suspended" | "invited";
  roles: string[];
  scopes: string[];
  lastSeenAt: number | null;
  neverSignedIn: boolean;
};

/** Access invite row (client). */
type AccessInviteClient = {
  id: string;
  email: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
};

/** Access plane section (client). */
type AccessPlaneClient = {
  plane: "user" | "operator";
  operators?: AccessOperatorClient[];
  users?: Array<{
    id: string;
    email: string;
    name: string;
    status: "active" | "disabled";
    roles: string[];
    scopes: string[];
  }>;
  roles: Array<{
    id: string;
    name: string;
    plane: "user" | "operator";
    description: string;
    scopes: string[];
    memberCount: number;
  }>;
  keys: AccessKeyClient[];
  invites?: AccessInviteClient[];
  grantableScopes: string[];
};

/** Console client surface used by the shell (keeps UI free of App import). */
interface ConsoleClient {
  readonly console: {
    setupStatus: (input: Record<string, never>) => CallResult<{
      setupClosed: boolean;
      claimRequired: boolean;
    }>;
    setupClaim: (input: {
      claimCode: string;
      email: string;
      name: string;
      password: string;
    }) => CallResult<{
      accessToken: string;
      refreshToken: string;
      operatorId: string;
      email: string;
      name: string;
    }>;
    sessionLogin: (input: { email: string; password: string }) => CallResult<{
      accessToken: string;
      refreshToken: string;
      operatorId: string;
      email: string;
      name: string;
    }>;
    sessionMe: (input: Record<string, never>) => CallResult<{
      operatorId: string;
      email: string;
      name: string;
      setupClosed: boolean;
    }>;
    sessionLogout: (input: Record<string, never>) => CallResult<{ ok: true }>;
    manifestGet: (input: Record<string, never>) => CallResult<{
      manifest: unknown;
    }>;
    runsList: (input: Record<string, never>) => CallResult<{
      runs: Array<{
        id: string;
        parentId: string | null;
        flow: string;
        unit: string | null;
        trigger: string;
        plane: string;
        tenant: string | null;
        principal: string | null;
        gates: string[];
        cache: "hit" | "miss" | "none";
        replica: "primary" | "replica" | null;
        replicaLagMs: number | null;
        cost: number | null;
        promptVersion: number | null;
        buildVersion: string | null;
        startedAt: number;
        endedAt: number;
        durationMs: number;
        error: string | null;
        sampled: "full" | "error" | "sample" | "boost";
        effects: Array<{
          kind: "read" | "write" | "emit" | "send" | "ask" | "secret" | "call";
          resource: string;
          timestamp: number;
          duration: number;
          reversibility:
            | "none"
            | "reversible"
            | "deferred"
            | "irreversible"
            | "capability"
            | "portal";
        }>;
        logs: Array<{
          level: "debug" | "info" | "warn" | "error";
          message: string;
          data?: Record<string, unknown>;
          at: number;
        }>;
        dimensions: Record<string, string | number | boolean | null>;
      }>;
    }>;
    actionPing: (input: { note?: string }) => CallResult<{
      ok: true;
      note?: string;
      at: number;
    }>;
    flowsIdentities: (input: Record<string, never>) => CallResult<{
      identities: Array<{
        id: string;
        email: string;
        name: string;
        status: string;
        scopes: string[];
      }>;
    }>;
    flowsInvoke: (input: {
      flowId: string;
      body: unknown;
      asUserId: string;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      ok: true;
      flowId: string;
      asUserId: string;
      trigger: string;
      response: unknown;
      peakTier: string;
      auditedAt: number;
    }>;
    tracesReplay: (input: { rootId: string; dryRun: boolean }) => CallResult<{
      ok: true;
      rootId: string;
      dryRun: boolean;
      at: number;
    }>;
    signalsList: (input: Record<string, never>) => CallResult<{
      signals: Array<{
        name: string;
        delivery: "once" | "broadcast" | "live";
        retries: number;
        deadLetterEnabled: boolean;
        orphaned: boolean;
        pending: number;
        inflight: number;
        dead: number;
        delivered: number;
        outboxLagMs: number | null;
        connections: number;
        throughputPerSec: number;
        schema?: unknown;
        subscribers: Array<{
          id: string;
          lag: number;
          errorCount: number;
        }>;
        recentLive: unknown[];
        deadLetters: Array<{
          id: string;
          signal: string;
          payload: unknown;
          delivery: "once" | "broadcast" | "live";
          attempts: number;
          failures: Array<{
            code: string;
            message: string;
            at: number;
            attempt: number;
          }>;
          createdAt: number;
          availableAt: number;
          status: "dead";
          causeRunId?: string;
          causeFlow?: string;
        }>;
        producers: Array<{
          flowId: string;
          durable: boolean;
          external: boolean;
          peakTier: string;
        }>;
        consumers: Array<{
          flowId: string;
          durable: boolean;
          external: boolean;
          peakTier: string;
        }>;
        consumersDurable: boolean | null;
      }>;
    }>;
    signalsReplay: (input: {
      signal: string;
      messageIds?: string[];
      subscriberId?: string;
      ratePerSec?: number;
      dryRun: boolean;
      payloads?: Record<string, unknown>;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      ok: true;
      attempted: number;
      succeeded: number;
      failed: number;
      dryRun: boolean;
      results: Array<{
        id: string;
        ok: boolean;
        error?: { code: string; message: string };
      }>;
      wouldHaveFired: Array<{
        kind: "send" | "ask";
        resource: string;
        messageId?: string;
      }>;
      at: number;
    }>;
    signalsDryRunReplay: (input: {
      signal: string;
      messageIds?: string[];
      subscriberId?: string;
      ratePerSec?: number;
      payloads?: Record<string, unknown>;
    }) => CallResult<{
      ok: true;
      attempted: number;
      succeeded: number;
      failed: number;
      dryRun: boolean;
      results: Array<{
        id: string;
        ok: boolean;
        error?: { code: string; message: string };
      }>;
      wouldHaveFired: Array<{
        kind: "send" | "ask";
        resource: string;
        messageId?: string;
      }>;
      at: number;
    }>;
    signalsDiscard: (input: {
      signal: string;
      messageIds: string[];
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      ok: true;
      discarded: number;
      at: number;
    }>;
    storeList: (input: Record<string, never>) => CallResult<{
      tenancyDeclared: boolean;
      tenants: string[];
      stores: Array<{
        ref: string;
        facet: "sql" | "kv" | "files" | "index";
        name: string;
        description?: string;
        children: Array<{
          name: string;
          effectRef: string;
          writers: string[];
          readers: string[];
          cache: {
            producedByRead: string;
            invalidatedByWrites: string[];
            invalidatingFlowIds: string[];
          };
          willNotFire: {
            writerFlowIds: string[];
            signals: string[];
            channels: string[];
          };
          piiColumns: string[];
          columnDescriptions: Record<string, string>;
        }>;
        replicaLagMs: number | null;
        migrationDrift: {
          declared: string;
          applied: string | null;
          drifted: boolean;
        } | null;
        contentAddressed: boolean;
        warnings: Array<{ code: string; message: string; key: string }>;
      }>;
    }>;
    storeQuery: (input: {
      ref: string;
      child?: string;
      tenant?: string;
      prefix?: string;
      limit?: number;
      vector?: number[];
      topK?: number;
    }) => CallResult<{
      facet: "sql" | "kv" | "files" | "index";
      rows?: Array<Record<string, unknown>>;
      keys?: Array<{
        key: string;
        value?: unknown;
        warnings?: Array<{ code: string; message: string }>;
      }>;
      hits?: Array<{
        id: string;
        score: number;
        meta?: Record<string, unknown>;
      }>;
      masked: boolean;
      routedRole?: "primary" | "replica";
    }>;
    storeReveal: (input: {
      ref: string;
      child?: string;
      tenant?: string;
      id: string;
      column: string;
    }) => CallResult<{ ok: true; value: unknown; at: number }>;
    storeEdit: (input: {
      ref: string;
      child?: string;
      tenant?: string;
      id?: string;
      key?: string;
      patch: Record<string, unknown>;
      confirmation?: string;
      reason?: string;
      commit?: boolean;
    }) => CallResult<{
      ok: true;
      dryRun: boolean;
      applied: boolean;
      willNotFire: {
        writerFlowIds: string[];
        signals: string[];
        channels: string[];
      };
      wouldHaveFired: Array<{ kind: "send" | "ask"; resource: string }>;
      at: number;
    }>;
    storeDelete: (input: {
      ref: string;
      child?: string;
      tenant?: string;
      ids?: string[];
      keys?: string[];
      confirmation?: string;
      reason?: string;
    }) => CallResult<{ ok: true; deleted: number; at: number }>;
    storePurgeCache: (input: {
      resource: string;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{ ok: true; keys: string[]; at: number }>;
    storeSql: (input: {
      ref: string;
      sql: string;
      tenant?: string;
      allowWrite?: boolean;
    }) => CallResult<{
      rows: Array<Record<string, unknown>>;
      masked: boolean;
      routedRole: "primary" | "replica";
    }>;
    storePreview: (input: {
      ref: string;
      child?: string;
      tenant?: string;
      id?: string;
      key?: string;
      patch: Record<string, unknown>;
    }) => CallResult<{
      ok: true;
      dryRun: true;
      willNotFire: {
        writerFlowIds: string[];
        signals: string[];
        channels: string[];
      };
      wouldHaveFired: Array<{ kind: "send" | "ask"; resource: string }>;
      at: number;
    }>;
    vaultList: (input: Record<string, never>) => CallResult<{
      secrets: Array<{
        name: string;
        kind: "secret" | "config";
        sensitive: boolean;
        description?: string;
        rotate?: string;
        fingerprints: Record<string, string>;
        fingerprint: string | null;
        cleartext: string | null;
        winner: "process.env" | ".env.local" | ".env.docker" | "driver" | "dev-fallback" | null;
        resolution: Array<{
          source: "process.env" | ".env.local" | ".env.docker" | "driver" | "dev-fallback";
          present: boolean;
          won: boolean;
        }>;
        readers: string[];
        blastRadius: {
          count: number;
          longestWakeAt: number | null;
          longestOutstandingMs: number | null;
          runIds: string[];
        };
        lastReadAt: number | null;
        sharedFingerprintEnvs: string[];
      }>;
      env: string;
    }>;
    vaultSet: (input: {
      name: string;
      value: string;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      ok: true;
      name: string;
      fingerprint: string | null;
      at: number;
    }>;
    vaultRotate: (input: {
      name: string;
      value: string;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      ok: true;
      name: string;
      fingerprint: string | null;
      at: number;
    }>;
    aiList: (input: Record<string, never>) => CallResult<{
      prompts: Array<{
        name: string;
        version?: number;
        model?: string;
        evals?: string;
        budgetMaxCostPerCall: number | null;
        manifestDiffPath: string;
      }>;
      agents: Array<{
        name: string;
        tools: string[];
        maxSteps?: number;
        model?: string;
        budgetMaxCostPerRun: number | null;
      }>;
      versions: Array<{
        prompt: string;
        version: number;
        sampleCount: number;
        cost: {
          samples: number[];
          mean: number;
          p50: number;
          p95: number;
          buckets: Array<{ min: number; max: number; count: number }>;
        };
        latencyMs: {
          samples: number[];
          mean: number;
          p50: number;
          p95: number;
          buckets: Array<{ min: number; max: number; count: number }>;
        };
        evalScore: {
          samples: number[];
          mean: number;
          p50: number;
          p95: number;
          buckets: Array<{ min: number; max: number; count: number }>;
        };
        schemaInvalidRate: number;
        providerErrorRate: number;
        okRate: number;
        overBudgetRate: number;
        budgetMaxCostPerCall: number | null;
        outcomeCounts: {
          ok: number;
          provider_error: number;
          schema_invalid: number;
        };
      }>;
      allowPii: Array<{
        flowId: string;
        asks: string[];
        pii: "masked" | "allow" | "denied" | null;
        allowPii: boolean;
        source: string | null;
      }>;
      fallbackChains: Array<{
        prompt: string;
        version?: number;
        attempts: Array<{
          model: string;
          ok: boolean;
          error?: string;
          cost?: number;
          latencyMs?: number;
          at: number;
        }>;
        actualCost: number;
        primaryOnlyCost: number | null;
        costConsequence: number | null;
        at: number;
      }>;
      agentRuns: Array<{
        id: string;
        agent: string;
        message: string;
        ok: boolean;
        steps: number;
        cost: number;
        at: number;
        trail: Array<{
          tool: string;
          status: "ok" | "denied";
          effects: Array<{
            kind: "read" | "write" | "emit" | "send" | "ask" | "secret" | "call";
            resource: string;
          }>;
          denial: {
            agent: string;
            tool: string;
            gate: string;
            reason: string;
            at: number;
          } | null;
          at: number;
        }>;
        denials: Array<{
          agent: string;
          tool: string;
          gate: string;
          reason: string;
          at: number;
        }>;
      }>;
      denials: Array<{
        agent: string;
        tool: string;
        gate: string;
        reason: string;
        at: number;
      }>;
    }>;
    clockList: (input: Record<string, never>) => CallResult<{
      now: number;
      crons: Array<{
        name: string;
        status: "active" | "paused" | "orphaned";
        timezone: string;
        overridable: boolean;
        declaredCron?: string;
        declaredEvery?: string;
        effectiveCron?: string;
        effectiveEvery?: string;
        lastRunAt?: number;
        nextRunAt?: number;
        health: {
          driftMs: number | null;
          overdue: boolean;
          missedRuns: number;
          catchUp: "one";
          leaderInstanceId?: string;
          leaderLeaseUntil?: number;
        };
        dstAmbiguity: {
          kind: "gap" | "overlap";
          reason: string;
          on: string;
          localTime: string;
        } | null;
        external: boolean;
        flowIds: string[];
      }>;
      waitingOn: Array<{
        runId: string;
        flow: string;
        label: string;
        wakeAt: number;
        wakeInMs: number;
        step: string | null;
      }>;
      waitingOnCounts: Array<{ label: string; count: number }>;
      timeline: Array<{
        at: number;
        kind: "cron" | "wake";
        name: string;
        meta?: string;
      }>;
    }>;
    clockRunNow: (input: { name: string; confirmation?: string; reason?: string }) => CallResult<{
      ok: true;
      name: string;
      ran: boolean;
      at: number;
    }>;
    clockPause: (input: { name: string }) => CallResult<{
      ok: true;
      name: string;
      status: string;
      at: number;
    }>;
    clockEditSchedule: (input: { name: string; cron?: string; every?: string }) => CallResult<{
      ok: true;
      name: string;
      effectiveCron?: string;
      effectiveEvery?: string;
      at: number;
    }>;
    clockWakeEarly: (input: { runId: string }) => CallResult<{
      ok: true;
      runId: string;
      wakeAt: number;
      resumed: boolean;
      at: number;
    }>;
    channelsList: (input: Record<string, never>) => CallResult<{
      face: "inbox" | "deliverability";
      production: boolean;
      templates: Array<{
        name: string;
        medium: string;
        locales: string[];
        from: string | null;
        schema: unknown;
      }>;
      outcomes: Array<{
        state:
          | "suppressed/opted-out"
          | "suppressed/prior-bounce"
          | "blocked/invalid-address"
          | "soft-bounce"
          | "hard-bounce"
          | "provider-error"
          | "delivered-then-complained";
        count: number;
        verdict: "correct" | "retry" | "suppress" | "review";
        weight: number;
      }>;
      fallback: {
        template: string | null;
        chainExample: string;
        fallbackRate: number;
        fallbackCount: number;
        totalCount: number;
        weeklyDeltaUsd: number;
        primaryMedium: string;
        fallbackMedium: string;
        summary: string;
      };
      inbox: Array<{
        id: string;
        medium: string;
        toMasked: string;
        subject: string | null;
        text: string | null;
        html: string | null;
        template: string | null;
        locale: string | null;
        at: number;
      }>;
      receipts: Array<{
        id: string;
        template: string;
        toMasked: string;
        medium: string;
        locale: string | null;
        localeChain: string[];
        status: string;
        chain: string;
        messageId: string | null;
        at: number;
        error: string | null;
      }>;
      suppression: Array<{
        subjectMasked: string;
        medium: string;
        reason: "opted-out" | "prior-bounce";
        at: number;
      }>;
    }>;
    channelPreview: (input: {
      template: string;
      locale?: string;
      profileLocale?: string;
      acceptLanguage?: string;
      data?: Record<string, unknown>;
    }) => CallResult<{
      template: string;
      locale: string;
      localeChain: string[];
      dir: "ltr" | "rtl";
      subject: string | null;
      text: string | null;
      html: string | null;
    }>;
    channelVerifyAuth: (input: { from: string }) => CallResult<{
      domain: string;
      spf: "pass" | "fail" | "missing";
      dkim: "pass" | "fail" | "missing";
      dmarc: "pass" | "fail" | "missing";
      checkedAt: number;
    }>;
    channelReveal: (input: { id: string }) => CallResult<{
      ok: true;
      id: string;
      to: string;
      at: number;
    }>;
    channelSendTest: (input: {
      template: string;
      to: string;
      locale?: string;
      data?: Record<string, unknown>;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      ok: boolean;
      messageId: string;
      status: string;
      chain: string;
      at: number;
    }>;
    gatesList: (input: Record<string, never>) => CallResult<{
      moduleActions: string[];
      flows: Array<{
        flowId: string;
        plane: "user" | "operator";
        gates: string[];
        unguarded: boolean;
      }>;
      gates: Array<{
        name: string;
        kind: "policy" | "rate";
        scopes: string[];
        roles: string[];
        strategy?: string;
        max?: number;
        per?: string;
        keyBy?: string;
        overridable: boolean;
        attachedTo: string[];
      }>;
      principals: Array<{
        kind: "role" | "key" | "user";
        id: string;
        name: string;
        plane: "user" | "operator";
        scopes: string[];
        memberCount?: number;
        email?: string;
      }>;
      violations: Array<{
        kind: "operator-application-scope";
        operatorId: string;
        name: string;
        email: string;
        applicationScopes: string[];
      }>;
      audit: {
        unguardedFlows: string[];
        orphanPermissions: string[];
        emptyRoles: string[];
        unattachedGates: string[];
      };
      widenings: Array<{
        path: string;
        category: string;
        kind: string;
        summary: string;
        before?: unknown;
        after?: unknown;
      }>;
    }>;
    gatesSimulate: (input: {
      flowId: string;
      principal: { kind: "role" | "key" | "user"; id: string };
      meta?: { ip?: string };
    }) => CallResult<{
      flowId: string;
      gates: string[];
      evaluations: Array<{
        name: string;
        allowed: boolean;
        kind: "policy" | "rate";
        remaining?: number;
        retryAfterMs?: number;
        reason?: string;
      }>;
      deniedAt: string | null;
      denial: {
        code: "Unauthorized" | "Forbidden" | "RateLimited";
        data: Record<string, unknown>;
        status: 401 | 403 | 429;
      } | null;
      allowed: boolean;
    }>;
    gatesPowers: (input: { kind: "role" | "key" | "user"; id: string }) => CallResult<{
      scopes: string[];
      allowedFlowIds: string[];
      deniedFlowIds: string[];
    }>;
    accessList: (input: Record<string, never>) => CallResult<{
      operatorPlane: AccessPlaneClient;
      userPlane: AccessPlaneClient;
      hygiene: {
        unusedKeys: AccessKeyClient[];
        neverSignedInOperators: AccessOperatorClient[];
        expiredInvitations: AccessInviteClient[];
      };
      accessTtlMs: number;
      catalog: string[];
    }>;
    accessEffective: (input: {
      kind: "operator" | "user" | "role" | "key";
      id: string;
    }) => CallResult<{
      kind: "operator" | "user" | "role" | "key";
      id: string;
      plane: "user" | "operator";
      scopes: Array<{
        scope: string;
        sources: Array<{ kind: "role" | "direct"; id: string; name: string }>;
      }>;
    }>;
    accessKeyBlast: (input: { keyId: string }) => CallResult<{
      callVolume: number;
      lastUsedAt: number | null;
      sourceAddresses: string[];
      accessTtlMs: number;
      residualAccessNote: string;
    }>;
    accessCreateKey: (input: {
      plane: "user" | "operator";
      name: string;
      scopes: string[];
      expiresAt?: number | null;
      rateLimit?: { max: number; per: string } | null;
      ipAllowlist?: string[];
    }) => CallResult<{
      key: AccessKeyClient;
      secret: string;
    }>;
    accessRevokeKey: (input: {
      keyId: string;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      key: AccessKeyClient;
      blastRadius: {
        callVolume: number;
        lastUsedAt: number | null;
        sourceAddresses: string[];
        accessTtlMs: number;
        residualAccessNote: string;
      };
    }>;
    accessRotateKey: (input: {
      keyId: string;
      confirmation?: string;
      reason?: string;
    }) => CallResult<{
      key: AccessKeyClient;
      secret: string;
      blastRadius: {
        callVolume: number;
        lastUsedAt: number | null;
        sourceAddresses: string[];
        accessTtlMs: number;
        residualAccessNote: string;
      };
    }>;
    accessSetRoleGrants: (input: {
      roleId: string;
      scopes: string[];
    }) => CallResult<{ roleId: string; scopes: string[] }>;
    diffList: (input: Record<string, never>) => CallResult<{
      hasBaseline: boolean;
      severity:
        | "contract-breaking"
        | "permission-widening"
        | "effect-widening"
        | "no-impact"
        | null;
      blockedCount: number;
      acknowledgedCount: number;
      changes: Array<{
        path: string;
        category: "contract-breaking" | "permission-widening" | "effect-widening" | "no-impact";
        kind: "added" | "removed" | "changed";
        summary: string;
        before?: unknown;
        after?: unknown;
        flowName: string | null;
        runCountLastWeek: number;
        blastLine: string | null;
        weeklyDeltaUsd: number | null;
        weeklyBillLine: string | null;
        ciGate: "blocked" | "acknowledged" | null;
      }>;
    }>;
    pluginsList: (input: Record<string, never>) => CallResult<{
      stateDerivation: string;
      plugins: Array<{
        id: string;
        origin: "core" | "local" | "community";
        state: "on" | "off";
        version: string | null;
        summary: string | null;
        scopes: Array<{ kind: "app" | "unit" | "flow"; name?: string }>;
        declares: string[];
        tables: Record<string, { plane?: string; description?: string }>;
        intercepts: Array<{
          stage: string;
          meanMs: number | null;
          count: number;
        }>;
        hookCost: {
          count: number;
          meanMs: number;
          p50Ms: number;
          p95Ms: number;
          lastMs: number | null;
        } | null;
        supplyChain: {
          lifecycleScripts: {
            state: string;
            scripts: string[];
            detail: string;
          };
          releaseCooldown: {
            state: string;
            publishedAt: number | null;
            holdUntil: number | null;
            detail: string;
          };
          nodeImportScan: {
            state: string;
            findings: Array<{
              source: string;
              specifier: string;
              line: number | null;
            }>;
            detail: string;
          };
          npmProvenance: { state: string; detail: string };
          bootConflicts: {
            state: string;
            conflicts: string[];
            detail: string;
          };
        };
        capabilityDiff: Array<{
          path: string;
          category: string;
          kind: string;
          summary: string;
        }>;
        installCommand: string | null;
        enableHint: string | null;
        packageName: string | null;
      }>;
    }>;
  };
}

/** Typed Console API (REST from `/_oke/client.json` at runtime). */
export const consoleApi = createClient(
  typeof globalThis.location !== "undefined" ? globalThis.location.origin : "http://127.0.0.1:6533",
  {
    headers: () =>
      (accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) as Record<string, string>,
    routes: {
      "console.setupStatus": { method: "GET", path: "/console/setup/status" },
      "console.setupClaim": { method: "POST", path: "/console/setup/claim" },
      "console.sessionLogin": { method: "POST", path: "/console/session/login" },
      "console.sessionMe": { method: "GET", path: "/console/session/me" },
      "console.sessionLogout": { method: "POST", path: "/console/session/logout" },
      "console.manifestGet": { method: "GET", path: "/console/manifest" },
      "console.runsList": { method: "GET", path: "/console/runs" },
      "console.actionPing": { method: "POST", path: "/console/action/ping" },
      "console.structuralPropose": {
        method: "POST",
        path: "/console/structural/propose",
      },
      "console.flowsIdentities": {
        method: "GET",
        path: "/console/flows/identities",
      },
      "console.flowsInvoke": {
        method: "POST",
        path: "/console/flows/invoke",
      },
      "console.tracesReplay": {
        method: "POST",
        path: "/console/traces/replay",
      },
      "console.signalsList": { method: "GET", path: "/console/signals" },
      "console.signalsReplay": {
        method: "POST",
        path: "/console/signals/replay",
      },
      "console.signalsDryRunReplay": {
        method: "POST",
        path: "/console/signals/dry-run-replay",
      },
      "console.signalsDiscard": {
        method: "POST",
        path: "/console/signals/discard",
      },
      "console.storeList": { method: "GET", path: "/console/store" },
      "console.storeQuery": { method: "POST", path: "/console/store/query" },
      "console.storeReveal": { method: "POST", path: "/console/store/reveal" },
      "console.storeEdit": { method: "POST", path: "/console/store/edit" },
      "console.storeDelete": { method: "POST", path: "/console/store/delete" },
      "console.storePurgeCache": {
        method: "POST",
        path: "/console/store/purge-cache",
      },
      "console.storeSql": { method: "POST", path: "/console/store/sql" },
      "console.storePreview": {
        method: "POST",
        path: "/console/store/preview",
      },
      "console.vaultList": { method: "GET", path: "/console/vault" },
      "console.vaultSet": { method: "POST", path: "/console/vault/set" },
      "console.vaultRotate": { method: "POST", path: "/console/vault/rotate" },
      "console.aiList": { method: "GET", path: "/console/ai" },
      "console.clockList": { method: "GET", path: "/console/clock" },
      "console.clockRunNow": {
        method: "POST",
        path: "/console/clock/run-now",
      },
      "console.clockPause": { method: "POST", path: "/console/clock/pause" },
      "console.clockEditSchedule": {
        method: "POST",
        path: "/console/clock/edit-schedule",
      },
      "console.clockWakeEarly": {
        method: "POST",
        path: "/console/clock/wake-early",
      },
      "console.channelsList": { method: "GET", path: "/console/channels" },
      "console.channelPreview": {
        method: "POST",
        path: "/console/channels/preview",
      },
      "console.channelVerifyAuth": {
        method: "POST",
        path: "/console/channels/verify-auth",
      },
      "console.channelReveal": {
        method: "POST",
        path: "/console/channels/reveal",
      },
      "console.channelSendTest": {
        method: "POST",
        path: "/console/channels/send-test",
      },
      "console.gatesList": { method: "GET", path: "/console/gates" },
      "console.gatesSimulate": {
        method: "POST",
        path: "/console/gates/simulate",
      },
      "console.gatesPowers": {
        method: "POST",
        path: "/console/gates/powers",
      },
      "console.accessList": { method: "GET", path: "/console/access" },
      "console.accessEffective": {
        method: "POST",
        path: "/console/access/effective",
      },
      "console.accessKeyBlast": {
        method: "POST",
        path: "/console/access/key-blast",
      },
      "console.accessCreateKey": {
        method: "POST",
        path: "/console/access/keys",
      },
      "console.accessRevokeKey": {
        method: "POST",
        path: "/console/access/keys/revoke",
      },
      "console.accessRotateKey": {
        method: "POST",
        path: "/console/access/keys/rotate",
      },
      "console.accessSetRoleGrants": {
        method: "POST",
        path: "/console/access/roles/grants",
      },
      "console.diffList": { method: "GET", path: "/console/diff" },
      "console.pluginsList": { method: "GET", path: "/console/plugins" },
    },
  },
) as unknown as ConsoleClient;

/** Loose call helpers used by the shell (keeps UI free of App type import). */
export const consoleCalls = {
  /**
   * Setup wizard status.
   */
  async setupStatus() {
    return consoleApi.console.setupStatus({});
  },
  /**
   * Claim first admin.
   *
   * @param body - Claim payload
   */
  async setupClaim(body: { claimCode: string; email: string; name: string; password: string }) {
    return consoleApi.console.setupClaim(body);
  },
  /**
   * Operator login.
   *
   * @param body - Credentials
   */
  async sessionLogin(body: { email: string; password: string }) {
    return consoleApi.console.sessionLogin(body);
  },
  /**
   * Current operator.
   */
  async sessionMe() {
    return consoleApi.console.sessionMe({});
  },
  /**
   * Audited ping action.
   *
   * @param note - Optional note
   */
  async actionPing(note?: string) {
    return consoleApi.console.actionPing({ note });
  },
  /**
   * List runs / traces.
   */
  async runsList() {
    return consoleApi.console.runsList({});
  },
  /**
   * Manifest snapshot for the causality view.
   */
  async manifestGet() {
    return consoleApi.console.manifestGet({});
  },
  /**
   * Identities for the invoke-as picker.
   */
  async flowsIdentities() {
    return consoleApi.console.flowsIdentities({});
  },
  /**
   * Invoke a flow as a user-plane identity.
   *
   * @param body - Invoke payload
   */
  async flowsInvoke(body: {
    flowId: string;
    body: unknown;
    asUserId: string;
    confirmation?: string;
    reason?: string;
  }) {
    return consoleApi.console.flowsInvoke(body);
  },
  /**
   * Replay a trace from the journal (dry-run when external effects present).
   *
   * @param body - Replay payload
   */
  async tracesReplay(body: { rootId: string; dryRun: boolean }) {
    return consoleApi.console.tracesReplay(body);
  },
  /**
   * List signals with live queue metrics.
   */
  async signalsList() {
    return consoleApi.console.signalsList({});
  },
  /**
   * Replay dead letters at a controlled rate.
   *
   * @param body - Replay payload
   */
  async signalsReplay(body: {
    signal: string;
    messageIds?: string[];
    subscriberId?: string;
    ratePerSec?: number;
    dryRun: boolean;
    payloads?: Record<string, unknown>;
    confirmation?: string;
    reason?: string;
  }) {
    return consoleApi.console.signalsReplay(body);
  },
  /**
   * Dry-run bulk repair — counts would-succeed / would-fail without mutating.
   *
   * @param body - Dry-run payload
   */
  async signalsDryRunReplay(body: {
    signal: string;
    messageIds?: string[];
    subscriberId?: string;
    ratePerSec?: number;
    payloads?: Record<string, unknown>;
  }) {
    return consoleApi.console.signalsDryRunReplay(body);
  },
  /**
   * Discard dead-letter messages.
   *
   * @param body - Discard payload
   */
  async signalsDiscard(body: {
    signal: string;
    messageIds: string[];
    confirmation?: string;
    reason?: string;
  }) {
    return consoleApi.console.signalsDiscard(body);
  },
  /**
   * List stores grouped by facet with cache / drift / warnings.
   */
  async storeList() {
    return consoleApi.console.storeList({});
  },
  /**
   * Browse a store facet.
   *
   * @param body - Query payload
   */
  async storeQuery(body: {
    ref: string;
    child?: string;
    tenant?: string;
    prefix?: string;
    limit?: number;
    vector?: number[];
    topK?: number;
  }) {
    return consoleApi.console.storeQuery(body);
  },
  /**
   * Audited PII reveal.
   *
   * @param body - Reveal payload
   */
  async storeReveal(body: {
    ref: string;
    child?: string;
    tenant?: string;
    id: string;
    column: string;
  }) {
    return consoleApi.console.storeReveal(body);
  },
  /**
   * Direct edit (not a flow execution).
   *
   * @param body - Edit payload
   */
  async storeEdit(body: {
    ref: string;
    child?: string;
    tenant?: string;
    id?: string;
    key?: string;
    patch: Record<string, unknown>;
    confirmation?: string;
    reason?: string;
    commit?: boolean;
  }) {
    return consoleApi.console.storeEdit(body);
  },
  /**
   * Delete rows/keys.
   *
   * @param body - Delete payload
   */
  async storeDelete(body: {
    ref: string;
    child?: string;
    tenant?: string;
    ids?: string[];
    keys?: string[];
    confirmation?: string;
    reason?: string;
  }) {
    return consoleApi.console.storeDelete(body);
  },
  /**
   * Purge cache namespace.
   *
   * @param body - Purge payload
   */
  async storePurgeCache(body: { resource: string; confirmation?: string; reason?: string }) {
    return consoleApi.console.storePurgeCache(body);
  },
  /**
   * SQL console (read-only by default).
   *
   * @param body - SQL payload
   */
  async storeSql(body: { ref: string; sql: string; tenant?: string; allowWrite?: boolean }) {
    return consoleApi.console.storeSql(body);
  },
  /**
   * Preview an edit via withDryRun isolation.
   *
   * @param body - Preview payload
   */
  async storePreview(body: {
    ref: string;
    child?: string;
    tenant?: string;
    id?: string;
    key?: string;
    patch: Record<string, unknown>;
  }) {
    return consoleApi.console.storePreview(body);
  },
  /**
   * List vault contracts — fingerprints only for secrets (console §9.8).
   */
  async vaultList() {
    return consoleApi.console.vaultList({});
  },
  /**
   * Set a vault value (write-only; never returns the value).
   *
   * @param body - Set payload
   */
  async vaultSet(body: { name: string; value: string; confirmation?: string; reason?: string }) {
    return consoleApi.console.vaultSet(body);
  },
  /**
   * Rotate a vault value (write-only; typed confirm required).
   *
   * @param body - Rotate payload
   */
  async vaultRotate(body: { name: string; value: string; confirmation?: string; reason?: string }) {
    return consoleApi.console.vaultRotate(body);
  },
  /**
   * AI panel projection — journal, denial ledger, distributions (console §9.10).
   */
  async aiList() {
    return consoleApi.console.aiList({});
  },
  /**
   * Clock panel — timeline, waiting-on, cron health (console §9.6).
   */
  async clockList() {
    return consoleApi.console.clockList({});
  },
  /**
   * Run a cron now (typed confirm when external in production).
   *
   * @param body - Run-now payload
   */
  async clockRunNow(body: { name: string; confirmation?: string; reason?: string }) {
    return consoleApi.console.clockRunNow(body);
  },
  /**
   * Pause a cron.
   *
   * @param body - Pause payload
   */
  async clockPause(body: { name: string }) {
    return consoleApi.console.clockPause(body);
  },
  /**
   * Edit an overridable schedule.
   *
   * @param body - Edit payload
   */
  async clockEditSchedule(body: { name: string; cron?: string; every?: string }) {
    return consoleApi.console.clockEditSchedule(body);
  },
  /**
   * Wake a sleeping durable run early.
   *
   * @param body - Wake-early payload
   */
  async clockWakeEarly(body: { runId: string }) {
    return consoleApi.console.clockWakeEarly(body);
  },
  /**
   * Channels panel — inbox / deliverability projection (console §9.9).
   */
  async channelsList() {
    return consoleApi.console.channelsList({});
  },
  /**
   * Locale-resolved template preview with RTL dir.
   *
   * @param body - Preview payload
   */
  async channelPreview(body: {
    template: string;
    locale?: string;
    profileLocale?: string;
    acceptLanguage?: string;
    data?: Record<string, unknown>;
  }) {
    return consoleApi.console.channelPreview(body);
  },
  /**
   * SPF / DKIM / DMARC verification for a From domain.
   *
   * @param body - From address or domain
   */
  async channelVerifyAuth(body: { from: string }) {
    return consoleApi.console.channelVerifyAuth(body);
  },
  /**
   * Audited recipient PII reveal.
   *
   * @param body - Receipt / inbox id
   */
  async channelReveal(body: { id: string }) {
    return consoleApi.console.channelReveal(body);
  },
  /**
   * Real send-test through the Channel runtime (never dry-run).
   *
   * @param body - Template + recipient + optional typed confirm
   */
  async channelSendTest(body: {
    template: string;
    to: string;
    locale?: string;
    data?: Record<string, unknown>;
    confirmation?: string;
    reason?: string;
  }) {
    return consoleApi.console.channelSendTest(body);
  },
  /**
   * Gates panel projection — principals, flows, audit, widenings.
   */
  async gatesList() {
    return consoleApi.console.gatesList({});
  },
  /**
   * Evaluate-only gate chain simulator (never runs the handler).
   *
   * @param body - Flow + principal
   */
  async gatesSimulate(body: {
    flowId: string;
    principal: { kind: "role" | "key" | "user"; id: string };
    meta?: { ip?: string };
  }) {
    return consoleApi.console.gatesSimulate(body);
  },
  /**
   * Principal powers — scopes + allowed/denied flows.
   *
   * @param body - Principal
   */
  async gatesPowers(body: { kind: "role" | "key" | "user"; id: string }) {
    return consoleApi.console.gatesPowers(body);
  },
  /**
   * Access panel projection — planes, grantable scopes, hygiene.
   */
  async accessList() {
    return consoleApi.console.accessList({});
  },
  /**
   * Effective permissions with provenance.
   *
   * @param body - Principal
   */
  async accessEffective(body: { kind: "operator" | "user" | "role" | "key"; id: string }) {
    return consoleApi.console.accessEffective(body);
  },
  /**
   * Key revocation blast radius from Runs.
   *
   * @param body - Key id
   */
  async accessKeyBlast(body: { keyId: string }) {
    return consoleApi.console.accessKeyBlast(body);
  },
  /**
   * Create an attenuated API key (secret shown once).
   *
   * @param body - Plane, name, scopes
   */
  async accessCreateKey(body: {
    plane: "user" | "operator";
    name: string;
    scopes: string[];
    expiresAt?: number | null;
    rateLimit?: { max: number; per: string } | null;
    ipAllowlist?: string[];
  }) {
    return consoleApi.console.accessCreateKey(body);
  },
  /**
   * Revoke an API key (typed confirm).
   *
   * @param body - Key id + confirmation
   */
  async accessRevokeKey(body: { keyId: string; confirmation?: string; reason?: string }) {
    return consoleApi.console.accessRevokeKey(body);
  },
  /**
   * Rotate an API key secret (typed confirm; secret once).
   *
   * @param body - Key id + confirmation
   */
  async accessRotateKey(body: { keyId: string; confirmation?: string; reason?: string }) {
    return consoleApi.console.accessRotateKey(body);
  },
  /**
   * Replace role grants (grantable scopes only).
   *
   * @param body - Role id + scopes
   */
  async accessSetRoleGrants(body: { roleId: string; scopes: string[] }) {
    return consoleApi.console.accessSetRoleGrants(body);
  },
  /**
   * Manifest Diff projection — classified changes × Runs traffic × weekly bill.
   */
  async diffList() {
    return consoleApi.console.diffList({});
  },
  /**
   * Plugins panel — origin × state, supply-chain, capability diff (read-only).
   */
  async pluginsList() {
    return consoleApi.console.pluginsList({});
  },
};
