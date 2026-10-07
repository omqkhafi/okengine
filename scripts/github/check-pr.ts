#!/usr/bin/env bun
/**
 * Pull-request metadata check. Reads the workflow event and the GitHub API.
 * Prints every failure, then exits 1. Board membership is skipped when
 * `PROJECT_TOKEN` is unset.
 *
 *   bun scripts/github/check-pr.ts
 */

import { ghApi, ghGraphql, isRecord } from "./gh.ts";
import { unreleasedChanged } from "./changelog.ts";

const TITLE_TYPES = ["feat", "fix", "docs", "refactor", "perf", "test", "chore"] as const;
type TitleType = (typeof TITLE_TYPES)[number];

const TYPE_LABEL: Readonly<Record<TitleType, string>> = {
  feat: "type: feature",
  fix: "type: fix",
  docs: "type: docs",
  refactor: "type: refactor",
  perf: "type: perf",
  test: "type: test",
  chore: "type: chore",
};

const CHANGELOG_EXEMPT = new Set(["type: chore", "type: test", "type: docs"]);
const TITLE = /^(feat|fix|docs|refactor|perf|test|chore)\(([^)]+)\)(!)?: (\S.*)$/;
const LINK = /\b(Closes|Refs)\s+#(\d+)\b/gi;
const PROJECT_TITLE = "okengine";
const PROJECT_OWNER = "omqkhafi";

export interface LinkedIssue {
  readonly number: number;
  readonly exists: boolean;
  /** Issue type name, or null when the issue has no type. */
  readonly typeName: string | null;
  readonly milestone: string | null;
  /** Null skips the board check (no project token). */
  readonly onBoard: boolean | null;
}

export interface PrSnapshot {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly milestone: string | null;
  readonly baseRef: string;
  readonly headRef: string;
  readonly changelogAddedUnderUnreleased: boolean;
  readonly linkedIssues: readonly LinkedIssue[];
}

/**
 * Every metadata failure on the pull request. An empty list passes.
 *
 * @param pr - Snapshot assembled from the event and the API
 */
export function evaluatePr(pr: PrSnapshot): readonly string[] {
  const failures: string[] = [];
  const parsed = parseTitle(pr.title);
  const typeLabels = pr.labels.filter((label) => label.startsWith("type: "));
  const areaLabels = pr.labels.filter((label) => label.startsWith("area: "));

  if (parsed === null) {
    failures.push(
      "title must match type(scope): summary (feat, fix, docs, refactor, perf, test, chore; ! marks breaking)",
    );
  }

  if (typeLabels.length !== 1) {
    failures.push(`pull request needs exactly one type: label (found ${typeLabels.length})`);
  } else if (parsed !== null && typeLabels[0] !== TYPE_LABEL[parsed.type]) {
    failures.push(`title type ${parsed.type} must use label ${TYPE_LABEL[parsed.type]}`);
  }

  if (areaLabels.length === 0) {
    failures.push("pull request needs at least one area: label");
  }

  const breaking = (parsed?.breaking ?? false) || breakingSectionHasContent(pr.body);
  if (breaking && !pr.labels.includes("breaking")) {
    failures.push("breaking title or section needs the breaking label");
  }

  if (pr.milestone === null) {
    failures.push("pull request milestone is not set");
  }

  if (pr.baseRef === "main" && pr.headRef !== "dev") {
    failures.push("pull requests into main must come from dev");
  }

  const links = linkedNumbers(pr.body);
  if (links.length === 0) {
    failures.push("body must contain Closes #N or Refs #N");
  }

  for (const issue of pr.linkedIssues) {
    if (!issue.exists) {
      failures.push(`issue #${issue.number} does not exist`);
      continue;
    }
    if (issue.typeName === "Epic") {
      failures.push(`issue #${issue.number} is an Epic; a pull request closes a leaf issue`);
    }
    if (pr.milestone !== null && issue.milestone !== pr.milestone) {
      const issueMilestone = issue.milestone ?? "unset";
      failures.push(
        `pull request milestone ${pr.milestone} does not match issue #${issue.number} milestone ${issueMilestone}`,
      );
    }
    if (issue.onBoard === false) {
      failures.push(`issue #${issue.number} is not on the ${PROJECT_TITLE} board`);
    }
  }

  const exempt = typeLabels.some((label) => CHANGELOG_EXEMPT.has(label));
  if (!exempt && !pr.changelogAddedUnderUnreleased) {
    failures.push("changelog.md needs an entry under ## Unreleased");
  }

  return failures;
}

/**
 * A heading that contains 💥 and has text under it, ignoring HTML comments.
 *
 * @param body - Pull request body
 */
export function breakingSectionHasContent(body: string): boolean {
  const lines = body.split("\n");
  let inSection = false;
  const content: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s+.*💥/.test(line)) {
      inSection = true;
      content.length = 0;
      continue;
    }
    if (inSection && /^#{1,6}\s+/.test(line)) break;
    if (inSection) content.push(line);
  }
  const withoutComments = content.join("\n").replace(/<!--[\s\S]*?-->/g, "");
  return withoutComments.trim().length > 0;
}

/** @param body - Pull request body */
export function linkedNumbers(body: string): readonly number[] {
  const numbers: number[] = [];
  for (const match of body.matchAll(LINK)) {
    const raw = match[2];
    if (raw === undefined) continue;
    const number = Number(raw);
    if (!numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

function parseTitle(title: string): { type: TitleType; breaking: boolean } | null {
  const match = TITLE.exec(title.trim());
  if (match === null) return null;
  const type = match[1];
  if (!isTitleType(type)) return null;
  return { type, breaking: match[3] === "!" };
}

function isTitleType(value: string): value is TitleType {
  return (TITLE_TYPES as readonly string[]).includes(value);
}

interface EventPull {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly milestone: string | null;
  readonly baseRef: string;
  readonly headRef: string;
  readonly baseSha: string;
  readonly headSha: string;
}

function readEvent(raw: string): { repo: string; pull: EventPull } {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("event payload is not an object");
  const repository = parsed["repository"];
  const pull = parsed["pull_request"];
  if (!isRecord(repository) || typeof repository["full_name"] !== "string") {
    throw new Error("event payload has no repository.full_name");
  }
  if (!isRecord(pull)) throw new Error("event payload has no pull_request");
  const base = pull["base"];
  const head = pull["head"];
  if (!isRecord(base) || !isRecord(head)) throw new Error("pull request has no base or head");
  if (typeof pull["title"] !== "string") throw new Error("pull request has no title");
  if (typeof base["ref"] !== "string" || typeof base["sha"] !== "string") {
    throw new Error("pull request base is incomplete");
  }
  if (typeof head["ref"] !== "string" || typeof head["sha"] !== "string") {
    throw new Error("pull request head is incomplete");
  }
  const labels: string[] = [];
  if (Array.isArray(pull["labels"])) {
    for (const label of pull["labels"]) {
      if (isRecord(label) && typeof label["name"] === "string") labels.push(label["name"]);
    }
  }
  const milestone = pull["milestone"];
  return {
    repo: repository["full_name"],
    pull: {
      title: pull["title"],
      body: typeof pull["body"] === "string" ? pull["body"] : "",
      labels,
      milestone:
        isRecord(milestone) && typeof milestone["title"] === "string" ? milestone["title"] : null,
      baseRef: base["ref"],
      headRef: head["ref"],
      baseSha: base["sha"],
      headSha: head["sha"],
    },
  };
}

async function fileAt(repo: string, path: string, ref: string): Promise<string> {
  try {
    return await ghApi([
      `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      "-H",
      "Accept: application/vnd.github.raw",
    ]);
  } catch {
    return "";
  }
}

async function loadIssue(
  repo: string,
  number: number,
  projectId: string | null,
  token: string | undefined,
): Promise<LinkedIssue> {
  let payload: unknown;
  try {
    payload = JSON.parse(await ghApi([`repos/${repo}/issues/${number}`]));
  } catch {
    return {
      number,
      exists: false,
      typeName: null,
      milestone: null,
      onBoard: projectId === null ? null : false,
    };
  }
  if (!isRecord(payload) || payload["message"] === "Not Found") {
    return {
      number,
      exists: false,
      typeName: null,
      milestone: null,
      onBoard: projectId === null ? null : false,
    };
  }
  const type = payload["type"];
  const milestone = payload["milestone"];
  const onBoard =
    projectId === null || token === undefined
      ? null
      : await issueOnBoard(payload["node_id"], projectId, token);
  return {
    number,
    exists: true,
    typeName: isRecord(type) && typeof type["name"] === "string" ? type["name"] : null,
    milestone:
      isRecord(milestone) && typeof milestone["title"] === "string" ? milestone["title"] : null,
    onBoard,
  };
}

async function okengineProjectId(token: string): Promise<string | null> {
  const data = await ghGraphql<{
    user: { projectsV2: { nodes: { id: string; title: string }[] } } | null;
  }>(
    `query($login: String!) {
      user(login: $login) {
        projectsV2(first: 20) { nodes { id title } }
      }
    }`,
    { login: PROJECT_OWNER },
    token,
  );
  const nodes = data.user?.projectsV2.nodes ?? [];
  return nodes.find((project) => project.title === PROJECT_TITLE)?.id ?? null;
}

async function issueOnBoard(nodeId: unknown, projectId: string, token: string): Promise<boolean> {
  if (typeof nodeId !== "string") return false;
  const data = await ghGraphql<{
    node: { projectItems: { nodes: { project: { id: string } }[] } } | null;
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on Issue {
          projectItems(first: 20) { nodes { project { id } } }
        }
      }
    }`,
    { id: nodeId },
    token,
  );
  const items = data.node?.projectItems.nodes ?? [];
  return items.some((item) => item.project.id === projectId);
}

async function main(): Promise<void> {
  const eventPath = process.env["GITHUB_EVENT_PATH"];
  if (eventPath === undefined) throw new Error("GITHUB_EVENT_PATH is unset");
  const event = readEvent(await Bun.file(eventPath).text());
  const token = process.env["PROJECT_TOKEN"];
  const projectId = token === undefined || token === "" ? null : await okengineProjectId(token);
  if (token === undefined || token === "") {
    console.log("pr-meta: skipped board check (PROJECT_TOKEN unset)");
  }
  const numbers = linkedNumbers(event.pull.body);
  const linkedIssues: LinkedIssue[] = [];
  for (const number of numbers) {
    linkedIssues.push(await loadIssue(event.repo, number, projectId, token));
  }
  const [baseLog, headLog] = await Promise.all([
    fileAt(event.repo, "changelog.md", event.pull.baseSha),
    fileAt(event.repo, "changelog.md", event.pull.headSha),
  ]);
  const failures = evaluatePr({
    title: event.pull.title,
    body: event.pull.body,
    labels: event.pull.labels,
    milestone: event.pull.milestone,
    baseRef: event.pull.baseRef,
    headRef: event.pull.headRef,
    changelogAddedUnderUnreleased: unreleasedChanged(baseLog, headLog),
    linkedIssues,
  });
  if (failures.length === 0) {
    console.log("pr-meta: ok");
    return;
  }
  for (const failure of failures) console.error(`pr-meta: ${failure}`);
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
