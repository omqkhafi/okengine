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
    sessionLogin: (input: {
      email: string;
      password: string;
    }) => CallResult<{
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
          kind:
            | "read"
            | "write"
            | "emit"
            | "send"
            | "ask"
            | "secret"
            | "call";
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
    tracesReplay: (input: {
      rootId: string;
      dryRun: boolean;
    }) => CallResult<{
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
  };
}

/** Typed Console API (REST from `/_oke/client.json` at runtime). */
export const consoleApi = createClient(
  typeof globalThis.location !== "undefined"
    ? globalThis.location.origin
    : "http://127.0.0.1:6533",
  {
    headers: () =>
      (accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {}) as Record<string, string>,
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
  async setupClaim(body: {
    claimCode: string;
    email: string;
    name: string;
    password: string;
  }) {
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
  async storePurgeCache(body: {
    resource: string;
    confirmation?: string;
    reason?: string;
  }) {
    return consoleApi.console.storePurgeCache(body);
  },
  /**
   * SQL console (read-only by default).
   *
   * @param body - SQL payload
   */
  async storeSql(body: {
    ref: string;
    sql: string;
    tenant?: string;
    allowWrite?: boolean;
  }) {
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
};
