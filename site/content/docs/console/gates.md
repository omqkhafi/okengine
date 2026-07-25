---
title: "Gates"
description: "Permission matrix, rate counters, MFA map."
source: "docs/spec/console.md"
---

#### 9.7 Gates

**We refuse the thing everyone builds:** a roles × permissions matrix. With 200 flows and 15 roles that is 3,000 cells nobody reads. The matrix is a dense overview you filter *into*, never the entry point.

**Two directions of inquiry instead** — from a principal ("what can this role, key or user do?") or from a flow ("what guards this?") — the same bidirectionality as the Flows panel.

**The simulator is the centrepiece.** The most frequent question in any system is "why did this user get a 403?" and its inverse. We know the gate chain **in evaluation order**, so we show exactly where it stopped and which typed error it produces. Order is the information: knowing that `booking:create` passed and the rate limit denied tells you the problem is operational, not declarative. A list without order sends you hunting through permissions for an hour.

**Continuous security audit: flows with no gate.** In the user plane, a flow without a gate is public. Surfacing "3 flows are unguarded" after every deploy turns a yearly review into a standing check. Also surfaced: permissions granted to no role, roles with no members, gates never attached.

**Deploy diff.** "`reports.export` widened: staff → member" is the most dangerous line in the panel — silent permission widening is the commonest finding in security reviews, and here it is caught from the Manifest diff *before* release rather than after.

**The two planes never mix.** An operator holding an application scope is displayed as a violation, not as a row.
