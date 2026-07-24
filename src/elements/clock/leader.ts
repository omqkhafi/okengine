/**
 * Cron leader election — N instances, one run (unified-theory · Clone axis).
 *
 * Lease lives on the reconciled cron row so the Console can show which
 * instance holds it (console §9.6).
 */

/** Cron row fields the lease mutates. */
export interface LeaseTarget {
  /** Schedule name. */
  readonly name: string;
  /** Instance currently holding the lease, if any. */
  leaderInstanceId?: string;
  /** Absolute lease expiry epoch-ms. */
  leaderLeaseUntil?: number;
}

/** Store surface required by {@link tryAcquireLease}. */
export interface LeaseStore {
  /**
   * @param name - Cron name
   */
  get(name: string): Promise<LeaseTarget | undefined>;
  /**
   * @param row - Updated row
   */
  put(row: LeaseTarget): Promise<void>;
  /**
   * Optional atomic acquire — preferred when present (memory / sql).
   *
   * @param name - Cron name
   * @param instanceId - Candidate instance
   * @param now - Current epoch-ms
   * @param leaseMs - Lease TTL
   */
  acquireLease?(
    name: string,
    instanceId: string,
    now: number,
    leaseMs: number,
  ): Promise<boolean>;
}

/** Options for {@link tryAcquireLease}. */
export interface AcquireLeaseOptions {
  /** Cron name. */
  readonly name: string;
  /** This instance's id. */
  readonly instanceId: string;
  /** Current epoch-ms. */
  readonly now: number;
  /** Lease TTL in milliseconds. */
  readonly leaseMs: number;
  /** Backing store. */
  readonly store: LeaseStore;
}

/**
 * Try to acquire (or renew) the leader lease for a cron.
 *
 * Returns `true` when this instance holds the lease after the call —
 * only then may it execute the schedule.
 *
 * @param options - Name, instance, clock, store
 */
export async function tryAcquireLease(
  options: AcquireLeaseOptions,
): Promise<boolean> {
  if (options.store.acquireLease) {
    return options.store.acquireLease(
      options.name,
      options.instanceId,
      options.now,
      options.leaseMs,
    );
  }

  const row = await options.store.get(options.name);
  if (!row) return false;

  const held =
    row.leaderLeaseUntil !== undefined &&
    row.leaderLeaseUntil > options.now &&
    row.leaderInstanceId !== undefined &&
    row.leaderInstanceId !== options.instanceId;

  if (held) return false;

  const next: LeaseTarget = {
    ...row,
    leaderInstanceId: options.instanceId,
    leaderLeaseUntil: options.now + options.leaseMs,
  };
  await options.store.put(next);

  // Re-read: lose the race if another writer won.
  const confirmed = await options.store.get(options.name);
  return (
    confirmed?.leaderInstanceId === options.instanceId &&
    (confirmed.leaderLeaseUntil ?? 0) > options.now
  );
}

/**
 * Release the lease when held by `instanceId` (best-effort).
 *
 * @param store - Lease store
 * @param name - Cron name
 * @param instanceId - Instance that should release
 * @param now - Current epoch-ms
 */
export async function releaseLease(
  store: LeaseStore,
  name: string,
  instanceId: string,
  now: number,
): Promise<void> {
  const row = await store.get(name);
  if (!row) return;
  if (row.leaderInstanceId !== instanceId) return;
  if (row.leaderLeaseUntil !== undefined && row.leaderLeaseUntil <= now) return;
  await store.put({
    ...row,
    leaderInstanceId: undefined,
    leaderLeaseUntil: undefined,
  });
}
