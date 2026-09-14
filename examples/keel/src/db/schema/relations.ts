import { store } from "okengine";

import { activity } from "./activity.ts";
import { comments } from "./comments.ts";
import { customFieldValues } from "./customFieldValues.ts";
import { customFields } from "./customFields.ts";
import { documents } from "./documents.ts";
import { fileObjects } from "./fileObjects.ts";
import { formSubmissions } from "./formSubmissions.ts";
import { forms } from "./forms.ts";
import { goals } from "./goals.ts";
import { inbox } from "./inbox.ts";
import { members } from "./members.ts";
import { projectUpdates } from "./projectUpdates.ts";
import { projects } from "./projects.ts";
import { recurrence } from "./recurrence.ts";
import { sections } from "./sections.ts";
import { spaces } from "./spaces.ts";
import { tags } from "./tags.ts";
import { taskAssignees } from "./taskAssignees.ts";
import { taskDependencies } from "./taskDependencies.ts";
import { taskFollowers } from "./taskFollowers.ts";
import { taskTags } from "./taskTags.ts";
import { tasks } from "./tasks.ts";
import { views } from "./views.ts";

/** RQB v2 relations — keys match emitted Drizzle export names. */
export const keelRelations = store.schema.relations(
  {
    spaces,
    members,
    goals,
    projects,
    sections,
    tasks,
    task_assignees: taskAssignees,
    task_followers: taskFollowers,
    task_dependencies: taskDependencies,
    tags,
    task_tags: taskTags,
    custom_fields: customFields,
    custom_field_values: customFieldValues,
    comments,
    activity,
    documents,
    file_objects: fileObjects,
    project_updates: projectUpdates,
    views,
    forms,
    form_submissions: formSubmissions,
    inbox,
    recurrence,
  },
  (r) => ({
    spaces: {
      members: r.many.members({ from: r.spaces.id, to: r.members.spaceId }),
      projects: r.many.projects({ from: r.spaces.id, to: r.projects.spaceId }),
    },
    members: {
      space: r.one.spaces({ from: r.members.spaceId, to: r.spaces.id }),
    },
    goals: {
      projects: r.many.projects({ from: r.goals.id, to: r.projects.goalId }),
    },
    projects: {
      space: r.one.spaces({ from: r.projects.spaceId, to: r.spaces.id, optional: false }),
      goal: r.one.goals({ from: r.projects.goalId, to: r.goals.id }),
      sections: r.many.sections({ from: r.projects.id, to: r.sections.projectId }),
      tasks: r.many.tasks({ from: r.projects.id, to: r.tasks.projectId }),
      updates: r.many.project_updates({ from: r.projects.id, to: r.project_updates.projectId }),
      views: r.many.views({ from: r.projects.id, to: r.views.projectId }),
      forms: r.many.forms({ from: r.projects.id, to: r.forms.projectId }),
    },
    sections: {
      project: r.one.projects({ from: r.sections.projectId, to: r.projects.id, optional: false }),
      tasks: r.many.tasks({ from: r.sections.id, to: r.tasks.sectionId }),
    },
    tasks: {
      space: r.one.spaces({ from: r.tasks.spaceId, to: r.spaces.id, optional: false }),
      project: r.one.projects({ from: r.tasks.projectId, to: r.projects.id }),
      section: r.one.sections({ from: r.tasks.sectionId, to: r.sections.id }),
      parent: r.one.tasks({ from: r.tasks.parentId, to: r.tasks.id }),
      assignees: r.many.task_assignees({ from: r.tasks.id, to: r.task_assignees.taskId }),
      followers: r.many.task_followers({ from: r.tasks.id, to: r.task_followers.taskId }),
      comments: r.many.comments({ from: r.tasks.id, to: r.comments.taskId }),
      tags: r.many.task_tags({ from: r.tasks.id, to: r.task_tags.taskId }),
    },
    task_assignees: {
      task: r.one.tasks({ from: r.task_assignees.taskId, to: r.tasks.id, optional: false }),
    },
    comments: {
      task: r.one.tasks({ from: r.comments.taskId, to: r.tasks.id, optional: false }),
    },
    forms: {
      project: r.one.projects({ from: r.forms.projectId, to: r.projects.id, optional: false }),
      submissions: r.many.form_submissions({ from: r.forms.id, to: r.form_submissions.formId }),
    },
    form_submissions: {
      form: r.one.forms({ from: r.form_submissions.formId, to: r.forms.id, optional: false }),
      task: r.one.tasks({ from: r.form_submissions.taskId, to: r.tasks.id }),
    },
  }),
);
