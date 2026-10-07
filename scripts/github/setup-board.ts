#!/usr/bin/env bun
/**
 * Create or update the okengine project: fields, views, readme, and the
 * repository link. Prints built-in workflows. There is no public API to
 * enable those workflows; the printout is the list Ali turns on in the UI.
 *
 *   bun scripts/github/setup-board.ts
 */

import { ghGraphql } from "./gh.ts";

const OWNER = "omqkhafi";
const TITLE = "okengine";
const REPO = "okengine";
const REPO_ID = "R_kgDOTipryw";

interface Option {
  readonly id: string;
  readonly name: string;
}

interface FieldNode {
  readonly id: string;
  readonly name: string;
  readonly databaseId: number | null;
  readonly options: readonly Option[];
}

interface ViewNode {
  readonly id: string;
  readonly number: number;
  readonly name: string;
}

const STATUS: readonly { name: string; color: string; description: string }[] = [
  { name: "Triage", color: "ORANGE", description: "New, not yet scoped" },
  { name: "Backlog", color: "GRAY", description: "Accepted, not ready" },
  {
    name: "Ready",
    color: "BLUE",
    description: "Has a type, priority, size, milestone, and acceptance points",
  },
  { name: "In progress", color: "YELLOW", description: "Someone is doing the work" },
  { name: "In review", color: "PURPLE", description: "A pull request is open" },
  { name: "Merged", color: "PINK", description: "Merged into dev; the release closes it" },
  { name: "Done", color: "GREEN", description: "Closed" },
];

const README = [
  "# okengine",
  "",
  "One board for the release train. Issues and pull requests land here from the repository.",
  "",
  "## Fields",
  "",
  "| Field | Values |",
  "| --- | --- |",
  "| Status | Triage, Backlog, Ready, In progress, In review, Merged, Done |",
  "| Priority | P0, P1, P2, P3 |",
  "| Size | XS, S, M, L, XL |",
  "| Iteration | Two weeks, starting Sunday 2026-10-11 |",
  "| Release | The open milestones (0.24, 0.25, …) |",
  "| Start date / Target date | Roadmap dates |",
  "",
  "A milestone change copies its title into Release when PROJECT_TOKEN is set.",
  "",
  "## Ready",
  "",
  "An item is Ready when it has all of these:",
  "",
  "- an issue type (Epic, Feature, Bug, or Task)",
  "- Priority",
  "- Size",
  "- a milestone",
  "- acceptance points in the body",
  "",
  "## Views",
  "",
  "Layouts and filters are set. Columns, group-by, and the roadmap date fields are not: the views REST API returned 404, and the view mutation has no group-by input. Set those in the view menu. See .github/settings.md.",
  "",
  "1. **Board** — open items, columns by Status, grouped by Priority.",
  "2. **Current release** — open items in the newest open milestone, grouped by the parent Epic, with sub-issue progress.",
  "3. **Roadmap** — Epics by Start date and Target date, grouped by Release.",
  "4. **Triage** — Status is Triage, or Priority, Size, or a milestone is missing.",
  "5. **My work** — assigned to the viewer, Status is In progress or In review.",
  "",
  "## Workflows",
  "",
  "Turn these on under the project menu, then Workflows. The API can list them and cannot enable them.",
  "",
  "- Item added to project → Status = Triage",
  "- Pull request linked to issue → Status = In review",
  "- A pull request merged into dev → its linked issues go to Merged (they stay open)",
  "- An issue closes when the release reaches main → Status = Done",
  "- Auto-archive, if the UI shows it → is:closed reason:completed updated:<@today-14d",
  "",
  "actions/add-to-project adds every new issue and pull request. That job, and the Release copy, skip cleanly while PROJECT_TOKEN is absent.",
].join("\n");

async function main(): Promise<void> {
  const project = await ensureProject();
  await linkRepo(project.id);
  await ghGraphql(
    `mutation($id: ID!, $readme: String!, $short: String!) {
      updateProjectV2(input: {
        projectId: $id
        public: true
        shortDescription: $short
        readme: $readme
      }) { projectV2 { number url } }
    }`,
    {
      id: project.id,
      readme: README,
      short: "Issue → triage → branch → pull request → CI → review → merge → release.",
    },
  );
  await ensureStatus(project.id);
  await ensureSelect(project.id, "Priority", [
    { name: "P0", color: "RED", description: "Drop other work" },
    { name: "P1", color: "ORANGE", description: "This release" },
    { name: "P2", color: "YELLOW", description: "Next if there is room" },
    { name: "P3", color: "GRAY", description: "Not scheduled" },
  ]);
  await ensureSelect(project.id, "Size", [
    { name: "XS", color: "GRAY", description: "Under an hour" },
    { name: "S", color: "GREEN", description: "About half a day" },
    { name: "M", color: "BLUE", description: "About a day" },
    { name: "L", color: "ORANGE", description: "Several days" },
    { name: "XL", color: "RED", description: "A week or more" },
  ]);
  await ensureSelect(project.id, "Release", [
    { name: "0.24", color: "PURPLE", description: "Pluggable deciders (breaking)" },
    { name: "0.25", color: "BLUE", description: "OKModel replaces Drizzle (breaking)" },
  ]);
  await ensureIteration(project.id);
  await ensureDate(project.id, "Start date");
  await ensureDate(project.id, "Target date");

  await ensureViews(project.id);
  await printWorkflows(project.id);
  console.log(`project ${project.number} ${project.url}`);
}

interface ProjectRef {
  readonly id: string;
  readonly number: number;
  readonly url: string;
}

async function ensureProject(): Promise<ProjectRef> {
  const data = await ghGraphql<{
    user: {
      projectsV2: { nodes: { id: string; number: number; title: string; url: string }[] };
    } | null;
  }>(
    `query($login: String!) {
      user(login: $login) { projectsV2(first: 20) { nodes { id number title url } } }
    }`,
    { login: OWNER },
  );
  const existing = data.user?.projectsV2.nodes.find((node) => node.title === TITLE);
  if (existing !== undefined) return existing;
  const proc = Bun.spawn(["gh", "project", "create", "--owner", OWNER, "--title", TITLE], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`gh project create failed (${code}): ${stderr.trim()}`);
  console.log(stdout.trim());
  const again = await ghGraphql<{
    user: {
      projectsV2: { nodes: { id: string; number: number; title: string; url: string }[] };
    } | null;
  }>(
    `query($login: String!) {
      user(login: $login) { projectsV2(first: 20) { nodes { id number title url } } }
    }`,
    { login: OWNER },
  );
  const created = again.user?.projectsV2.nodes.find((node) => node.title === TITLE);
  if (created === undefined) throw new Error("project create returned no okengine project");
  return created;
}

async function linkRepo(projectId: string): Promise<void> {
  try {
    await ghGraphql(
      `mutation($project: ID!, $repo: ID!) {
        linkProjectV2ToRepository(input: { projectId: $project, repositoryId: $repo }) { repository { id } }
      }`,
      { project: projectId, repo: REPO_ID },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already")) throw error;
  }
}

async function ensureStatus(projectId: string): Promise<void> {
  const fields = await loadFields(projectId);
  const status = fields.find((field) => field.name === "Status");
  if (status === undefined) throw new Error("project has no Status field");
  const names = status.options.map((option) => option.name).join(",");
  const wanted = STATUS.map((option) => option.name).join(",");
  if (names === wanted) return;
  const options = STATUS.map((option) => {
    const current = status.options.find((entry) => entry.name === option.name);
    return current === undefined ? option : { id: current.id, ...option };
  });
  await ghGraphql(
    `mutation($field: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
      updateProjectV2Field(input: { fieldId: $field, name: "Status", singleSelectOptions: $options }) {
        projectV2Field { ... on ProjectV2SingleSelectField { id } }
      }
    }`,
    { field: status.id, options },
  );
  console.log("updated Status");
}

async function ensureSelect(
  projectId: string,
  name: string,
  options: readonly { name: string; color: string; description: string }[],
): Promise<void> {
  const fields = await loadFields(projectId);
  if (fields.some((field) => field.name === name)) return;
  await ghGraphql(
    `mutation($project: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
      createProjectV2Field(input: {
        projectId: $project
        dataType: SINGLE_SELECT
        name: $name
        singleSelectOptions: $options
      }) { projectV2Field { ... on ProjectV2FieldCommon { id name } } }
    }`,
    { project: projectId, name, options },
  );
  console.log(`created ${name}`);
}

async function ensureDate(projectId: string, name: string): Promise<void> {
  const fields = await loadFields(projectId);
  if (fields.some((field) => field.name === name)) return;
  await ghGraphql(
    `mutation($project: ID!, $name: String!) {
      createProjectV2Field(input: { projectId: $project, dataType: DATE, name: $name }) {
        projectV2Field { ... on ProjectV2FieldCommon { id name } }
      }
    }`,
    { project: projectId, name },
  );
  console.log(`created ${name}`);
}

async function ensureIteration(projectId: string): Promise<void> {
  const fields = await loadFields(projectId);
  if (fields.some((field) => field.name === "Iteration")) return;
  await ghGraphql(
    `mutation($project: ID!, $iterations: [ProjectV2Iteration!]!) {
      createProjectV2Field(input: {
        projectId: $project
        dataType: ITERATION
        name: "Iteration"
        iterationConfiguration: { startDate: "2026-10-11", duration: 14, iterations: $iterations }
      }) { projectV2Field { ... on ProjectV2FieldCommon { id name } } }
    }`,
    { project: projectId, iterations: iterations() },
  );
  console.log("created Iteration");
}

function iterations(): { title: string; startDate: string; duration: number }[] {
  const items: { title: string; startDate: string; duration: number }[] = [];
  let cursor = Date.parse("2026-10-11T00:00:00Z");
  for (let index = 0; index < 6; index++) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + 13);
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    items.push({ title: `${startDate} – ${endDate}`, startDate, duration: 14 });
    cursor = end.getTime() + 24 * 60 * 60 * 1000;
  }
  return items;
}

async function loadFields(projectId: string): Promise<FieldNode[]> {
  const data = await ghGraphql<{
    node: {
      fields: {
        nodes: {
          id?: string;
          name?: string;
          databaseId?: number;
          options?: Option[];
        }[];
      };
    } | null;
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2FieldCommon { id name databaseId }
              ... on ProjectV2SingleSelectField { options { id name } }
            }
          }
        }
      }
    }`,
    { id: projectId },
  );
  const nodes = data.node?.fields.nodes ?? [];
  const fields: FieldNode[] = [];
  for (const node of nodes) {
    if (typeof node.id !== "string" || typeof node.name !== "string") continue;
    fields.push({
      id: node.id,
      name: node.name,
      databaseId: typeof node.databaseId === "number" ? node.databaseId : null,
      options: Array.isArray(node.options) ? node.options : [],
    });
  }
  return fields;
}

async function loadViews(projectId: string): Promise<ViewNode[]> {
  const data = await ghGraphql<{
    node: { views: { nodes: { id: string; number: number; name: string }[] } } | null;
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 { views(first: 20) { nodes { id number name } } }
      }
    }`,
    { id: projectId },
  );
  return data.node?.views.nodes ?? [];
}

const LAYOUT = {
  board: "BOARD_LAYOUT",
  table: "TABLE_LAYOUT",
  roadmap: "ROADMAP_LAYOUT",
} as const;

interface ViewSpec {
  readonly name: string;
  readonly layout: keyof typeof LAYOUT;
  readonly filter: string;
}

/**
 * Layout, name, and filter go through GraphQL. Grouping does not: the views
 * REST route that accepts `group_by` returned 404 for this user, and
 * `updateProjectV2View` has no group-by input. Those settings are in
 * `.github/settings.md` for the project UI.
 */
async function ensureViews(projectId: string): Promise<void> {
  const specs: readonly ViewSpec[] = [
    { name: "Board", layout: "board", filter: "is:open" },
    { name: "Current release", layout: "table", filter: 'is:open milestone:"0.24"' },
    { name: "Roadmap", layout: "roadmap", filter: "type:Epic" },
    {
      name: "Triage",
      layout: "table",
      filter: 'status:"Triage" OR no:priority OR no:size OR no:milestone',
    },
    { name: "My work", layout: "table", filter: 'assignee:@me status:"In progress","In review"' },
  ];
  let views = await loadViews(projectId);
  for (const spec of specs) {
    const found = views.find((view) => view.name === spec.name);
    if (found !== undefined) {
      await updateView(found.id, spec);
      console.log(`updated view ${spec.name}`);
      continue;
    }
    const fallback =
      spec.name === "Board" ? views.find((view) => view.name === "View 1") : undefined;
    if (fallback !== undefined) {
      await updateView(fallback.id, spec);
      console.log(`renamed view ${fallback.name} to ${spec.name}`);
      views = await loadViews(projectId);
      continue;
    }
    const created = await ghGraphql<{ createProjectV2View: { projectV2View: { id: string } } }>(
      `mutation($project: ID!, $name: String!, $layout: ProjectV2ViewLayout!) {
        createProjectV2View(input: { projectId: $project, name: $name, layout: $layout }) {
          projectV2View { id }
        }
      }`,
      { project: projectId, name: spec.name, layout: LAYOUT[spec.layout] },
    );
    await updateView(created.createProjectV2View.projectV2View.id, spec);
    console.log(`created view ${spec.name}`);
    views = await loadViews(projectId);
  }
}

async function updateView(viewId: string, spec: ViewSpec): Promise<void> {
  await ghGraphql(
    `mutation($id: ID!, $name: String!, $layout: ProjectV2ViewLayout!, $filter: String!) {
      updateProjectV2View(input: { viewId: $id, name: $name, layout: $layout, filter: $filter }) {
        projectV2View { id }
      }
    }`,
    { id: viewId, name: spec.name, layout: LAYOUT[spec.layout], filter: spec.filter },
  );
}

async function printWorkflows(projectId: string): Promise<void> {
  const data = await ghGraphql<{
    node: { workflows: { nodes: { name: string; enabled: boolean; number: number }[] } } | null;
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 { workflows(first: 20) { nodes { name enabled number } } }
      }
    }`,
    { id: projectId },
  );
  const workflows = data.node?.workflows.nodes ?? [];
  console.log("workflows:");
  for (const workflow of workflows) {
    console.log(`- ${workflow.name} (#${workflow.number}) enabled=${workflow.enabled}`);
  }
  console.log(`repository ${OWNER}/${REPO}`);
}

if (import.meta.main) {
  await main();
}
