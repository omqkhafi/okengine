#!/usr/bin/env bun
/**
 * Move okengine project items from a GitHub event.
 *
 * Skips when PROJECT_TOKEN is unset. Adds the issue or pull request if it
 * is missing, then:
 * - a new issue goes to Triage
 * - an opened pull request, and issues it `Closes`, go to In review
 * - a closed issue or pull request goes to Done
 * - a milestone change copies the title into Release, or clears it
 */

import { ghApi, ghGraphql, isRecord } from "./gh.ts";

const PROJECT_OWNER = "omqkhafi";
const PROJECT_TITLE = "okengine";

interface Option {
  readonly id: string;
  readonly name: string;
}

interface SelectField {
  readonly id: string;
  readonly name: string;
  readonly options: readonly Option[];
}

interface ProjectItemRef {
  readonly id: string;
}

async function main(): Promise<void> {
  const token = process.env["PROJECT_TOKEN"];
  if (token === undefined || token === "") {
    console.log("PROJECT_TOKEN is unset; skipping project update.");
    return;
  }
  const eventPath = process.env["GITHUB_EVENT_PATH"];
  const eventName = process.env["GITHUB_EVENT_NAME"];
  if (eventPath === undefined || eventName === undefined) throw new Error("GitHub event is unset");
  const event: unknown = JSON.parse(await Bun.file(eventPath).text());
  if (!isRecord(event) || typeof event["action"] !== "string")
    throw new Error("event has no action");

  const project = await loadProject(token);
  const subject = subjectOf(eventName, event);
  if (subject === null) {
    console.log("project event: nothing to update");
    return;
  }
  const item = await ensureItem(project.id, subject.nodeId, token);
  if (event["action"] === "opened" && eventName === "issues") {
    await setOption(project, item, "Status", "Triage", token);
  } else if (event["action"] === "opened" && eventName === "pull_request_target") {
    await setOption(project, item, "Status", "In review", token);
    for (const number of linkedIssueNumbers(subject.body)) {
      const linked = await issueNode(subject.repo, number);
      if (linked === null) continue;
      const linkedItem = await ensureItem(project.id, linked, token);
      await setOption(project, linkedItem, "Status", "In review", token);
    }
  } else if (event["action"] === "closed") {
    await setOption(project, item, "Status", "Done", token);
  } else if (event["action"] === "milestoned" || event["action"] === "demilestoned") {
    const title = milestoneTitle(event);
    if (event["action"] === "demilestoned" || title === null) {
      await clearField(project.id, item.id, fieldId(project.fields, "Release"), token);
    } else {
      await setOption(project, item, "Release", releaseOption(title), token);
    }
  }
  console.log(`project event: ${eventName} ${event["action"]} updated`);
}

function subjectOf(
  eventName: string,
  event: Record<string, unknown>,
): { nodeId: string; body: string; repo: string } | null {
  const repository = event["repository"];
  const repo =
    isRecord(repository) && typeof repository["full_name"] === "string"
      ? repository["full_name"]
      : "";
  const key = eventName === "pull_request_target" ? "pull_request" : "issue";
  const node = event[key];
  if (!isRecord(node) || typeof node["node_id"] !== "string") return null;
  return {
    nodeId: node["node_id"],
    body: typeof node["body"] === "string" ? node["body"] : "",
    repo,
  };
}

/** Release options stay version numbers. This milestone's title is the goal. */
const RELEASE_OPTION: Readonly<Record<string, string>> = {
  "OKModel replaces Drizzle (breaking)": "0.25",
};

function releaseOption(title: string): string {
  return RELEASE_OPTION[title] ?? title;
}

function milestoneTitle(event: Record<string, unknown>): string | null {
  const milestone = event["milestone"];
  if (isRecord(milestone) && typeof milestone["title"] === "string") return milestone["title"];
  return null;
}

function linkedIssueNumbers(body: string): readonly number[] {
  const numbers: number[] = [];
  for (const match of body.matchAll(/\b(?:Closes|Refs)\s+#(\d+)\b/gi)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const number = Number(raw);
    if (!numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

async function issueNode(repo: string, number: number): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await ghApi([`repos/${repo}/issues/${number}`]));
    if (!isRecord(parsed) || typeof parsed["node_id"] !== "string") return null;
    return parsed["node_id"];
  } catch {
    return null;
  }
}

interface LoadedProject {
  readonly id: string;
  readonly fields: readonly SelectField[];
}

async function loadProject(token: string): Promise<LoadedProject> {
  const data = await ghGraphql<{
    user: {
      projectsV2: {
        nodes: {
          id: string;
          title: string;
          fields: { nodes: { id?: string; name?: string; options?: Option[] }[] };
        }[];
      };
    } | null;
  }>(
    `query($login: String!) {
      user(login: $login) {
        projectsV2(first: 20) {
          nodes {
            id
            title
            fields(first: 40) {
              nodes {
                ... on ProjectV2SingleSelectField { id name options { id name } }
              }
            }
          }
        }
      }
    }`,
    { login: PROJECT_OWNER },
    token,
  );
  const project = data.user?.projectsV2.nodes.find((node) => node.title === PROJECT_TITLE);
  if (project === undefined) throw new Error(`project ${PROJECT_TITLE} was not found`);
  const fields: SelectField[] = [];
  for (const node of project.fields.nodes) {
    if (
      typeof node.id !== "string" ||
      typeof node.name !== "string" ||
      !Array.isArray(node.options)
    )
      continue;
    fields.push({ id: node.id, name: node.name, options: node.options });
  }
  return { id: project.id, fields };
}

function fieldId(fields: readonly SelectField[], name: string): string {
  const field = fields.find((entry) => entry.name === name);
  if (field === undefined) throw new Error(`project field ${name} was not found`);
  return field.id;
}

async function setOption(
  project: LoadedProject,
  item: ProjectItemRef,
  fieldName: string,
  optionName: string,
  token: string,
): Promise<void> {
  const field = project.fields.find((entry) => entry.name === fieldName);
  if (field === undefined) throw new Error(`project field ${fieldName} was not found`);
  const option = field.options.find((entry) => entry.name === optionName);
  if (option === undefined) {
    console.log(`project event: ${fieldName} has no option ${optionName}; leaving it unset`);
    return;
  }
  await ghGraphql(
    `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $project
        itemId: $item
        fieldId: $field
        value: { singleSelectOptionId: $option }
      }) { projectV2Item { id } }
    }`,
    { project: project.id, item: item.id, field: field.id, option: option.id },
    token,
  );
}

async function clearField(
  projectId: string,
  itemId: string,
  field: string,
  token: string,
): Promise<void> {
  await ghGraphql(
    `mutation($project: ID!, $item: ID!, $field: ID!) {
      clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) {
        projectV2Item { id }
      }
    }`,
    { project: projectId, item: itemId, field },
    token,
  );
}

async function ensureItem(
  projectId: string,
  contentId: string,
  token: string,
): Promise<ProjectItemRef> {
  const existing = await findItem(contentId, projectId, token);
  if (existing !== null) return existing;
  try {
    const data = await ghGraphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      `mutation($project: ID!, $content: ID!) {
        addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
      }`,
      { project: projectId, content: contentId },
      token,
    );
    return data.addProjectV2ItemById.item;
  } catch {
    const after = await findItem(contentId, projectId, token);
    if (after !== null) return after;
    throw new Error(`could not add ${contentId} to the project`);
  }
}

async function findItem(
  contentId: string,
  projectId: string,
  token: string,
): Promise<ProjectItemRef | null> {
  const data = await ghGraphql<{
    node: { projectItems: { nodes: { id: string; project: { id: string } }[] } } | null;
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on Issue { projectItems(first: 20) { nodes { id project { id } } } }
        ... on PullRequest { projectItems(first: 20) { nodes { id project { id } } } }
      }
    }`,
    { id: contentId },
    token,
  );
  const nodes = data.node?.projectItems.nodes ?? [];
  const found = nodes.find((node) => node.project.id === projectId);
  return found === undefined ? null : { id: found.id };
}

if (import.meta.main) {
  await main();
}
