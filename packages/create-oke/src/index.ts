#!/usr/bin/env bun
/**
 * `create-oke` binary entry — scaffold an okengine app.
 *
 * ```bash
 * bunx create-oke@latest my-app
 * bunx create-oke@latest my-app --yes
 * bunx create-oke@latest my-app --template hello
 * bunx create-oke@latest my-app --from-example notes
 * ```
 *
 * @module
 */

import { run } from "./cli.ts";

process.exit(await run(process.argv.slice(2)));
