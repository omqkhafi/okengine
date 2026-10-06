/**
 * Console workspace package.
 *
 * The implementation lives in `src/console`. `okengine/console` is the
 * supported public import. This package re-exports the same surface.
 */

export {
  bootConsoleApp,
  createConsoleApp,
  type ConsoleApp,
  type ConsoleAppHandle,
  type CreateConsoleAppOptions,
} from "../../src/console/index.ts";
