# Repository settings

Applied with `gh api`. Re-run the commands from the repository root. They do not change visibility, the default branch (`main`), or secrets.

`omqkhafi` is a user account, not an organization. Commands that need an organization are listed under [Not applied](#not-applied).

## Merge

`main` stays the default branch. The repository allows squash and merge commits. Rebase stays off. Feature pull requests squash into `dev`: the commit title is the pull request title and the body is the description. The release pull request merges `dev` into `main` with a merge commit, so `dev`'s history and its `Closes #N` commit messages land on `main`. The head branch is deleted after a squash. Do not delete `dev` when merging the release. Auto-merge is off.

`dev` ruleset allows squash only. `main` ruleset allows merge commit only.

```bash
gh api --method PATCH repos/omqkhafi/okengine \
  -F allow_squash_merge=true \
  -F allow_merge_commit=true \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=false \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY
```

## Rulesets

`dev` and `main` require a pull request, block direct pushes, force pushes, and deletion, and require review threads to be resolved. Required checks are `lint · fmt`, `typecheck`, `test · console`, `test · elements`, `test · kernel`, `test · cli`, `test · drivers`, `test · core`, `gate`, `site`, and `pr-meta`, all jobs of `.github/workflows/ci.yml`. A failing test shard does not cancel the others. There is no aggregator job. This repository has no app manifest, so CI does not run a manifest diff. Runners are `ubuntu-24.04`. npm and JSR publish run in `.github/workflows/release.yml` on a `v*` tag, so they are not pull-request checks.

The npm trusted publisher was `ci.yml` / `publish-npm`. Point it at `.github/workflows/release.yml`, job `publish-npm`, for `okengine` and `create-oke`, before the next tag. No `NPM_TOKEN`.

Pull requests into `main` must come from `dev`. The ruleset schema has no source-branch rule, so `scripts/github/check-pr.ts` rejects any other head. That check is part of `pr-meta`.

Applied: `dev` is ruleset `24659394`, `main` is ruleset `24659396`. Creating them again would add a second copy. Reapply with PUT:

```bash
gh api --method PUT repos/omqkhafi/okengine/rulesets/24659394 --input .github/rulesets/dev.json
gh api --method PUT repos/omqkhafi/okengine/rulesets/24659396 --input .github/rulesets/main.json
```

The create commands, if the rulesets are missing:

```bash
gh api --method POST repos/omqkhafi/okengine/rulesets --input .github/rulesets/dev.json
gh api --method POST repos/omqkhafi/okengine/rulesets --input .github/rulesets/main.json
```

## Discussions

Discussions are on. Enabling them created Q&A (answerable, slug `q-a`) and Ideas (slug `ideas`). Feature ideas stay in Ideas until a maintainer opens an issue. The issue form config points there. There is no `updateDiscussionCategory` mutation, so the category descriptions are GitHub's defaults.

```bash
gh api --method PATCH repos/omqkhafi/okengine -F has_discussions=true
```

## Labels, board, release field

```bash
bun scripts/github/sync-labels.ts --dry-run
bun scripts/github/sync-labels.ts
bun scripts/github/setup-board.ts
```

`setup-board.ts` is safe to re-run. It does not enable built-in workflows. The project is <https://github.com/users/omqkhafi/projects/2>.

### View settings the API cannot set

`POST /users/184851061/projectsV2/2/views` returned 404, and `updateProjectV2View` has no group-by field. Filters and layouts are set. In the project UI, set:

| View            | Also set                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Board           | Columns: Status. Group by: Priority.                                                                                          |
| Current release | Group by: Parent issue. Show Sub-issues progress. When 0.24 closes, change the filter milestone to the newest open milestone. |
| Roadmap         | Date fields: Start date and Target date. Group by: Release.                                                                   |
| Triage          | The filter is already `status:"Triage" OR no:priority OR no:size OR no:milestone`. Confirm the UI treats `OR` as or.          |
| My work         | The filter is already `assignee:@me` and Status In progress or In review.                                                     |

### Workflows to turn on

Project menu → Workflows. The API can list these and cannot enable or retarget them.

| Workflow                       | State when this file was written | Set                                                                  |
| ------------------------------ | -------------------------------- | -------------------------------------------------------------------- |
| Item added to project          | off                              | Status = Triage                                                      |
| Pull request linked to issue   | off                              | Status = In review                                                   |
| Item closed                    | on                               | Status = Done. An issue reaches Done when it closes, which is when the release reaches `main`. |
| Pull request merged            | on                               | The pull request item goes to Done. `project-event.ts` sets linked issues to Merged when the pull request merges into `dev`. Those issues stay open. |
| Auto-add sub-issues to project | on                               | leave on                                                             |
| Auto-close issue               | on                               | leave on                                                             |
| Auto-archive                   | not in the API list              | If the UI shows it: `is:closed reason:completed updated:<@today-14d` |

`.github/workflows/project.yml` runs `scripts/github/project-event.ts` when `PROJECT_TOKEN` is present, and skips when the secret is absent. An opened pull request moves its linked issues to In review. A merge into `dev` moves those issues to Merged. A closed issue moves to Done. A milestone change copies the title into Release.

## `PROJECT_TOKEN`

Create a fine-grained personal access token. Do not paste it into the repository. Store it as the Actions secret `PROJECT_TOKEN` on `omqkhafi/okengine`.

- Resource owner: `omqkhafi`
- Repository access: only `okengine`
- Account permissions: Projects — Read and write
- Repository permissions: Metadata — Read, Issues — Read, Pull requests — Read, Contents — Read

`actions/add-to-project` and `scripts/github/project-event.ts` use this token. `pr-meta` uses it only to check that a linked issue is on the board, and skips that check when the secret is absent.

## Not applied

### Issue types

`omqkhafi` is a user. Issue types exist on organizations.

```bash
gh api --method POST -H "X-GitHub-Api-Version: 2026-03-10" \
  orgs/omqkhafi/issue-types \
  -f name='Epic' \
  -f description='A feature that spans more than one pull request. Its sub-issues are the steps.' \
  -F is_enabled=true \
  -f color='purple'
```

Response: `404 Not Found` (`https://docs.github.com/rest/orgs/issue-types#create-issue-type-for-an-organization`). Not retried.

The forms still set `type:` to Epic, Feature, Bug, or Task (the docs form is a Task). Repeat the command for Feature, Bug, and Task once an organization owns the repository:

| Type    | Description                                                                    |
| ------- | ------------------------------------------------------------------------------ |
| Epic    | A feature that spans more than one pull request. Its sub-issues are the steps. |
| Feature | A change that ships in one pull request.                                       |
| Bug     | Something that does not behave as specified.                                   |
| Task    | Work that is not a feature or a bug.                                           |
