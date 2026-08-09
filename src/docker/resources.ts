/**
 * Server resource budget → per-service Compose `deploy.resources` limits.
 *
 * Defaults assume a small production host (4 CPU / 8 GiB). Callers may override
 * via {@link ServerBudget}. ~10% stays unallocated for the Docker daemon / OS.
 */

/** Host capacity used when apportioning container limits. */
export type ServerBudget = {
  /** Logical CPUs available to the stack (default 4). */
  readonly cpus: number;
  /** RAM in GiB available to the stack (default 8). */
  readonly memoryGb: number;
};

/** Default production host size when the client does not specify one. */
export const DEFAULT_SERVER_BUDGET: ServerBudget = {
  cpus: 4,
  memoryGb: 8,
};

/** Fraction of the host reserved for Docker / OS (not given to services). */
const HOST_OVERHEAD = 0.1;

/** Relative weights by compose role — heavier roles get a larger share. */
const ROLE_WEIGHT: Readonly<Record<string, number>> = {
  app: 20,
  "store.sql": 30,
  pgdog: 5,
  "store.kv": 15,
  "store.files": 10,
  "store.index": 10,
  "channel.email": 5,
  ai: 40,
  proxy: 5,
};

const DEFAULT_WEIGHT = 10;
const MIN_CPUS = 0.1;
const MIN_MEMORY_MB = 64;

/** Resolved CPU + memory limit for one compose service. */
export type ServiceResourceLimit = {
  readonly cpus: string;
  readonly memory: string;
};

/**
 * Normalise a partial budget against {@link DEFAULT_SERVER_BUDGET}.
 *
 * @param budget - Optional caller overrides
 */
export function resolveServerBudget(budget: Partial<ServerBudget> | undefined): ServerBudget {
  const cpus = budget?.cpus ?? DEFAULT_SERVER_BUDGET.cpus;
  const memoryGb = budget?.memoryGb ?? DEFAULT_SERVER_BUDGET.memoryGb;
  if (!(cpus > 0) || !Number.isFinite(cpus)) {
    throw new Error(
      `oke docker: server cpus must be a positive number (got ${String(budget?.cpus)})`,
    );
  }
  if (!(memoryGb > 0) || !Number.isFinite(memoryGb)) {
    throw new Error(
      `oke docker: server memoryGb must be a positive number (got ${String(budget?.memoryGb)})`,
    );
  }
  return { cpus, memoryGb };
}

/**
 * Apportion a server budget across named services (compose service names).
 *
 * @param serviceNames - Services that receive limits (`app`, `store-sql`, …)
 * @param budget - Host capacity
 * @returns Map of service name → deploy.resources.limits fields
 */
export function allocateServiceResources(
  serviceNames: readonly string[],
  budget: Partial<ServerBudget> | undefined = undefined,
): ReadonlyMap<string, ServiceResourceLimit> {
  const resolved = resolveServerBudget(budget);
  const usableCpus = resolved.cpus * (1 - HOST_OVERHEAD);
  const usableMemoryMb = resolved.memoryGb * 1024 * (1 - HOST_OVERHEAD);

  const weights = serviceNames.map((name) => {
    const role = serviceNameToRole(name);
    return ROLE_WEIGHT[role] ?? DEFAULT_WEIGHT;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const out = new Map<string, ServiceResourceLimit>();
  if (total <= 0 || serviceNames.length === 0) return out;

  for (let i = 0; i < serviceNames.length; i++) {
    const name = serviceNames[i]!;
    const share = weights[i]! / total;
    const cpus = Math.max(MIN_CPUS, roundCpus(usableCpus * share));
    const memoryMb = Math.max(MIN_MEMORY_MB, Math.round(usableMemoryMb * share));
    out.set(name, {
      cpus: formatCpus(cpus),
      memory: formatMemoryMb(memoryMb),
    });
  }
  return out;
}

/**
 * Build a Compose `deploy.resources` block from a limit, preserving any
 * existing reservations (e.g. GPU devices from AI recipes).
 *
 * @param limit - Allocated CPU / memory
 * @param existing - Prior `deploy` object from a recipe, if any
 */
export function mergeDeployResources(
  limit: ServiceResourceLimit,
  existing: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const prev = existing ? { ...existing } : {};
  const prevResources = isPlainObject(prev.resources)
    ? { ...prev.resources }
    : ({} as Record<string, unknown>);
  const prevLimits = isPlainObject(prevResources.limits)
    ? { ...prevResources.limits }
    : ({} as Record<string, unknown>);
  prevResources.limits = {
    ...prevLimits,
    cpus: limit.cpus,
    memory: limit.memory,
  };
  // Soft reservation ≈ half the limit so the scheduler can pack peers.
  const prevReservations = isPlainObject(prevResources.reservations)
    ? { ...prevResources.reservations }
    : ({} as Record<string, unknown>);
  if (prevReservations.cpus === undefined) {
    prevReservations.cpus = formatCpus(Math.max(MIN_CPUS, Number(limit.cpus) * 0.5));
  }
  if (prevReservations.memory === undefined) {
    prevReservations.memory = formatMemoryMb(
      Math.max(MIN_MEMORY_MB, Math.round(parseMemoryMb(limit.memory) * 0.5)),
    );
  }
  prevResources.reservations = prevReservations;
  prev.resources = prevResources;
  return prev;
}

function serviceNameToRole(serviceName: string): string {
  if (serviceName === "app") return "app";
  return serviceName.replaceAll("-", ".");
}

function roundCpus(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatCpus(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function formatMemoryMb(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}G`;
  if (mb >= 1024) {
    const gb = Math.round((mb / 1024) * 100) / 100;
    return `${gb}G`;
  }
  return `${mb}M`;
}

function parseMemoryMb(value: string): number {
  const m = /^(\d+(?:\.\d+)?)(G|M)$/i.exec(value);
  if (!m) return MIN_MEMORY_MB;
  const n = Number(m[1]);
  return m[2]!.toUpperCase() === "G" ? n * 1024 : n;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
