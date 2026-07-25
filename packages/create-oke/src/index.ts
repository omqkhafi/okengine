#!/usr/bin/env bun
/**
 * `create-oke` binary entry.
 */

import { run } from "./cli.ts";

process.exit(await run(process.argv.slice(2)));
