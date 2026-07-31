# OKE dependency pins and traps

Read from [SKILL.md](SKILL.md) when a bump looks suspicious. Update this file when a new trap is discovered.

## Intentional pins

| Package               | Where                   | Pin / form                   | Why                                                            |
| --------------------- | ----------------------- | ---------------------------- | -------------------------------------------------------------- |
| `drizzle-orm`         | root, template          | `^1.0.0-rc.4` (RC line)      | Framework targets Drizzle 1 RC; npm `latest` is `0.45.x`       |
| `drizzle-kit`         | root, template          | `^1.0.0-rc.4` (RC line)      | Must match orm channel; some canaries remove `drizzle-kit/cli` |
| `okengine`            | template                | `file:../..`                 | Local workspace link for scaffold tests                        |
| `@types/bun`          | root, create-oke        | `"latest"`                   | Track Bun types with the toolchain                             |
| `@fumadocs/base-ui`   | site                    | `^` aligned with core        | Real package name (not `fumadocs-ui` npm alias)                |
| `fumadocs-core`       | site                    | exact or `^` aligned with ui | Pair with `@fumadocs/base-ui` version                          |
| peer optional drivers | root `peerDependencies` | ranges like `>=0.5.0`        | Widen only when supported floor changes                        |

## Reject defaults for bulk `ncu`

When bulk-updating and Drizzle must not move off the RC line:

```bash
--reject drizzle-orm,drizzle-kit,okengine
```

Add more to `--reject` for any package the user said to leave alone.

## Post-install checks

| After bumping                     | Check                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------- |
| drizzle-*                         | `node_modules/drizzle-kit/cli.*` exists; lock entry is `1.0.0-rc.*` not `0.x` |
| fumadocs-*                        | `site/package.json` has `@fumadocs/base-ui`; core and ui versions match       |
| oxc-parser / `@oxc-project/types` | versions match each other                                                     |
| playwright / `@playwright/test`   | versions match each other                                                     |
| next + fumadocs                   | site `types:check` or a quick `next build` if majors moved                    |

## Version channel rule

```
if current matches /\d+\.\d+\.\d+-(rc|beta|alpha|canary)/
  → update only within that prerelease channel
  → never replace with registry "latest" when latest is a lower major/minor stable
```
