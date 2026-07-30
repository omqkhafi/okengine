/**
 * Fixture stores for unit tests and the axe gate.
 */

import type { StoreListResponse, StoreRecord } from "./types.ts";

/** Skyport-shaped Store fixture covering all four facets. */
export const STORE_FIXTURE: readonly StoreRecord[] = [
  {
    ref: "sql:db",
    facet: "sql",
    name: "db",
    children: [
      {
        name: "bookings",
        effectRef: "sql:bookings",
        writers: ["bookings.create"],
        readers: ["bookings.create", "bookings.mine"],
        cache: {
          producedByRead: "computed:sql:bookings",
          invalidatedByWrites: ["sql:bookings"],
          invalidatingFlowIds: ["bookings.create"],
        },
        willNotFire: {
          writerFlowIds: ["bookings.create"],
          signals: ["order-placed"],
          channels: [],
        },
        piiColumns: ["email"],
        columnDescriptions: {},
      },
      {
        name: "shipments",
        effectRef: "sql:shipments",
        writers: ["fulfillment.onOrder"],
        readers: [],
        cache: {
          producedByRead: "computed:sql:shipments",
          invalidatedByWrites: ["sql:shipments"],
          invalidatingFlowIds: ["fulfillment.onOrder"],
        },
        willNotFire: {
          writerFlowIds: ["fulfillment.onOrder"],
          signals: [],
          channels: ["booking-confirmed"],
        },
        piiColumns: [],
        columnDescriptions: {},
      },
    ],
    replicaLagMs: 240,
    migrationDrift: {
      declared: "abc123",
      applied: "abc123",
      drifted: false,
    },
    contentAddressed: false,
    warnings: [],
  },
  {
    ref: "kv:sessions",
    facet: "kv",
    name: "sessions",
    children: [
      {
        name: "sessions",
        effectRef: "kv:sessions",
        writers: [],
        readers: [],
        cache: {
          producedByRead: "computed:kv:sessions",
          invalidatedByWrites: [],
          invalidatingFlowIds: [],
        },
        willNotFire: {
          writerFlowIds: [],
          signals: [],
          channels: [],
        },
        piiColumns: [],
        columnDescriptions: {},
      },
    ],
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: false,
    warnings: [],
  },
  {
    ref: "files:uploads",
    facet: "files",
    name: "uploads",
    children: [
      {
        name: "uploads",
        effectRef: "files:uploads",
        writers: [],
        readers: [],
        cache: {
          producedByRead: "computed:files:uploads",
          invalidatedByWrites: [],
          invalidatingFlowIds: [],
        },
        willNotFire: {
          writerFlowIds: [],
          signals: [],
          channels: [],
        },
        piiColumns: [],
        columnDescriptions: {},
      },
    ],
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: true,
    warnings: [
      {
        code: "non_ascii_key",
        message: "Non-ASCII object key — signed URL encoding may break on S3-compatible stores.",
        key: "фото/id.jpg",
      },
    ],
  },
  {
    ref: "index:docs",
    facet: "index",
    name: "docs",
    children: [
      {
        name: "docs",
        effectRef: "index:docs",
        writers: [],
        readers: [],
        cache: {
          producedByRead: "computed:index:docs",
          invalidatedByWrites: [],
          invalidatingFlowIds: [],
        },
        willNotFire: {
          writerFlowIds: [],
          signals: [],
          channels: [],
        },
        piiColumns: [],
        columnDescriptions: {},
      },
    ],
    replicaLagMs: null,
    migrationDrift: null,
    contentAddressed: false,
    warnings: [],
  },
];

/** Full list envelope with tenancy declared (Skyport-shaped). */
export const STORE_LIST_FIXTURE: StoreListResponse = {
  tenancyDeclared: true,
  tenants: ["tenant_a", "tenant_b"],
  stores: STORE_FIXTURE,
};

/** List envelope without tenancy (Notes-shaped). */
export const STORE_LIST_NO_TENANCY: StoreListResponse = {
  tenancyDeclared: false,
  tenants: [],
  stores: STORE_FIXTURE,
};
