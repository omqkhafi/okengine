import { defineSeed, type Fx } from "okengine";
import { db } from "@/core";
import {
  cycles,
  documents,
  initiatives,
  issues,
  labels,
  members,
  projectMilestones,
  projects,
  projectUpdates,
  teams,
  workflowStates,
} from "@/db/schema.decl";

/**
 * Featured Linear story — ENG / DES / SUP, Aria/Ben, ENG-184.
 * Run with `oke db seed` (never at boot).
 */

async function workspace(fx: Fx) {
  await fx.store(db).upsert(teams, { id: "team_eng" }, {
    id: "team_eng",
    key: "ENG",
    name: "Engineering",
    parentId: null,
  });
  await fx.store(db).upsert(teams, { id: "team_des" }, {
    id: "team_des",
    key: "DES",
    name: "Design",
    parentId: "team_eng",
  });
  await fx.store(db).upsert(teams, { id: "team_sup" }, {
    id: "team_sup",
    key: "SUP",
    name: "Support",
    parentId: null,
  });

  await fx.store(db).upsert(members, { id: "mem_aria" }, {
    id: "mem_aria",
    teamId: "team_eng",
    name: "Aria Chen",
    email: "aria@keel.dev",
    role: "admin",
  });
  await fx.store(db).upsert(members, { id: "mem_ben" }, {
    id: "mem_ben",
    teamId: "team_eng",
    name: "Ben Okonkwo",
    email: "ben@keel.dev",
    role: "member",
  });

  const states = [
    { id: "st_eng_triage", teamId: "team_eng", name: "Triage", type: "triage", position: 0 },
    { id: "st_eng_todo", teamId: "team_eng", name: "Todo", type: "unstarted", position: 2 },
    { id: "st_eng_progress", teamId: "team_eng", name: "In Progress", type: "started", position: 3 },
    { id: "st_eng_done", teamId: "team_eng", name: "Done", type: "completed", position: 5 },
    { id: "st_eng_canceled", teamId: "team_eng", name: "Canceled", type: "canceled", position: 6 },
  ] as const;
  for (const state of states) {
    await fx.store(db).upsert(workflowStates, { id: state.id }, { ...state });
  }

  await fx.store(db).upsert(labels, { id: "lab_bug" }, {
    id: "lab_bug",
    teamId: null,
    name: "bug",
    groupName: "type",
  });
  await fx.store(db).upsert(labels, { id: "lab_feature" }, {
    id: "lab_feature",
    teamId: null,
    name: "feature",
    groupName: "type",
  });
}

async function featured(fx: Fx) {
  await fx.store(db).upsert(initiatives, { id: "init_console" }, {
    id: "init_console",
    name: "Ship Console Next",
    status: "active",
    ownerEmail: "aria@keel.dev",
    targetDate: "2026-09-30",
  });
  await fx.store(db).upsert(projects, { id: "proj_traces" }, {
    id: "proj_traces",
    initiativeId: "init_console",
    name: "Traces pane",
    status: "started",
    leadEmail: "aria@keel.dev",
    targetDate: "2026-08-29",
    progress: 62,
  });
  await fx.store(db).upsert(projectMilestones, { id: "ms_beta" }, {
    id: "ms_beta",
    projectId: "proj_traces",
    name: "Beta",
    targetDate: "2026-08-29",
    sortOrder: 2,
  });
  await fx.store(db).upsert(projectUpdates, { id: "upd_traces_1" }, {
    id: "upd_traces_1",
    projectId: "proj_traces",
    health: "on_track",
    body: "Chain highlight + waterfall tip landed. Beta is the remaining risk.",
    authorEmail: "aria@keel.dev",
  });
  await fx.store(db).upsert(cycles, { id: "cyc_24" }, {
    id: "cyc_24",
    teamId: "team_eng",
    number: 24,
    name: "Cycle 24",
    startsAt: "2026-07-13T00:00:00Z",
    endsAt: "2026-07-26T23:59:59Z",
    state: "completed",
  });
  await fx.store(db).upsert(cycles, { id: "cyc_25" }, {
    id: "cyc_25",
    teamId: "team_eng",
    number: 25,
    name: "Cycle 25",
    startsAt: "2026-07-27T00:00:00Z",
    endsAt: "2026-08-09T23:59:59Z",
    state: "active",
  });
  await fx.store(db).upsert(issues, { id: "iss_eng_184" }, {
    id: "iss_eng_184",
    identifier: "ENG-184",
    title: "Pulse graph on selected trace",
    description: "Highlight the github → create → notify chain when a Traces row is selected.",
    priority: 2,
    estimate: 5,
    stateId: "st_eng_progress",
    teamId: "team_eng",
    projectId: "proj_traces",
    milestoneId: "ms_beta",
    cycleId: "cyc_25",
    parentId: null,
    assigneeEmail: "aria@keel.dev",
    creatorEmail: "ben@keel.dev",
    dueDate: "2026-08-08",
    slaBreachesAt: null,
    triagedAt: "2026-07-28T10:00:00Z",
    archivedAt: null,
  });
  await fx.store(db).upsert(documents, { id: "doc_eng_184" }, {
    id: "doc_eng_184",
    title: "ENG-184 implementation spec",
    body: "Featured github → create → notify chain.",
    parentKind: "issue",
    parentId: "iss_eng_184",
  });
}

export default defineSeed({
  name: "keel",
  description: "Featured Linear story",
  essential: workspace,
  dev: featured,
});
