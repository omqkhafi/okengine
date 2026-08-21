import { describe, expect, test } from "bun:test";
import {
  FEATURED_COMMENTS,
  FEATURED_DOCUMENTS,
  FEATURED_MEMBERS,
  FEATURED_PROJECTS,
  FEATURED_SECTIONS,
  FEATURED_SPACES,
  FEATURED_TASKS,
  FEATURED_VIEWS,
} from "./featured.ts";
import { GENERATED, generateKeelVolume, KEEL_SEED_COUNTS, KEEL_VOLUME } from "./volume.ts";

describe("keel volume seed", () => {
  test("featured story keeps ENG-12 and Harbor spaces", () => {
    expect(FEATURED_TASKS.some((task) => task.id === "tsk_eng_12")).toBe(true);
    expect(FEATURED_MEMBERS.map((m) => m.id)).toEqual([
      "mem_demo",
      "mem_admin",
      "mem_aria",
      "mem_lead",
      "mem_ben",
      "mem_eli",
      "mem_cai",
      "mem_member",
      "mem_commenter",
      "mem_dia",
    ]);
    expect(FEATURED_MEMBERS.map((m) => m.role)).toEqual([
      "owner",
      "admin",
      "project_manager",
      "lead",
      "developer",
      "contributor",
      "member",
      "member",
      "commenter",
      "guest",
    ]);
    expect(FEATURED_MEMBERS.find((m) => m.id === "mem_demo")?.email).toBe("demo@example.com");
    expect(FEATURED_MEMBERS.find((m) => m.id === "mem_member")?.email).toBe("member@example.com");
    expect(FEATURED_SPACES.map((s) => s.key)).toEqual(["ENG", "DES", "GTM"]);
    const projectIds = new Set<string>(FEATURED_PROJECTS.map((project) => project.id));
    expect(FEATURED_SECTIONS.length).toBeGreaterThan(0);
    for (const section of FEATURED_SECTIONS) {
      expect(projectIds.has(section.projectId)).toBe(true);
    }
    expect(FEATURED_MEMBERS.find((m) => m.id === "mem_aria")?.role).toBe("project_manager");
    expect(FEATURED_MEMBERS.find((m) => m.id === "mem_ben")?.role).toBe("developer");
  });

  test("generated volume matches Console-scale counts", () => {
    expect(KEEL_VOLUME.members).toHaveLength(GENERATED.members);
    expect(KEEL_VOLUME.projects).toHaveLength(GENERATED.projects);
    expect(KEEL_VOLUME.tasks).toHaveLength(GENERATED.tasks);
    expect(KEEL_VOLUME.comments).toHaveLength(GENERATED.comments);
    expect(KEEL_VOLUME.drafts.length + KEEL_VOLUME.reminders.length).toBe(GENERATED.kvKeys);
    expect(KEEL_SEED_COUNTS.viewPrefs).toBe(FEATURED_VIEWS.length + KEEL_VOLUME.views.length);
    expect(KEEL_SEED_COUNTS.webhooks).toBeGreaterThan(0);
    expect(KEEL_VOLUME.files).toHaveLength(GENERATED.files);
    expect(KEEL_VOLUME.index).toHaveLength(GENERATED.index);
    expect(KEEL_SEED_COUNTS.indexDocuments).toBe(
      FEATURED_DOCUMENTS.length + KEEL_VOLUME.documents.length,
    );
    expect(KEEL_SEED_COUNTS.indexComments).toBe(
      FEATURED_COMMENTS.length + KEEL_VOLUME.comments.length,
    );
    expect(KEEL_SEED_COUNTS.indexProjects).toBe(
      FEATURED_PROJECTS.length + KEEL_VOLUME.projects.length,
    );
    expect(KEEL_SEED_COUNTS.tasks).toBeGreaterThanOrEqual(500);
    expect(KEEL_SEED_COUNTS.tasks).toBe(FEATURED_TASKS.length + GENERATED.tasks);
  });

  test("volume ids stay off the featured identifiers", () => {
    const featuredIds = new Set<string>(FEATURED_TASKS.map((task) => task.id));
    expect(KEEL_VOLUME.tasks.some((task) => featuredIds.has(task.id))).toBe(false);
    expect(KEEL_VOLUME.tasks[0]?.id).toMatch(/^tsk_(eng|des|gtm)_200$/);
    const fileRoots = new Set(KEEL_VOLUME.files.map((file) => file.key.split("/")[0]));
    expect(fileRoots).toEqual(
      new Set(["attachments", "documents", "avatars", "projects", "exports", "forms"]),
    );
    expect(KEEL_VOLUME.files.some((file) => file.key.startsWith("attachments/tsk_"))).toBe(true);
  });

  test("generator is deterministic", () => {
    const again = generateKeelVolume();
    expect(again.tasks[0]).toEqual(KEEL_VOLUME.tasks[0]);
    expect(again.tasks.at(-1)).toEqual(KEEL_VOLUME.tasks.at(-1));
    expect(again.comments[10]).toEqual(KEEL_VOLUME.comments[10]);
  });
});
