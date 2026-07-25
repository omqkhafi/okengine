#!/usr/bin/env bun
/**
 * `create-oke` binary entry — scaffold an okengine app.
 *
 * ```bash
 * bunx create-oke@latest my-app
 * bunx create-oke@latest my-app --template linkly
 * ```
 *
 * @module
 */

import { run } from "./cli.ts";

process.exit(await run(process.argv.slice(2)));
