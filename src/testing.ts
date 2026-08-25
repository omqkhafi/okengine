/**
 * Test harness (`createTestApp`). Subpath: `okengine/testing` or `okengine/test`.
 *
 * Kept out of core/client bundles via a dedicated `dist/testing.js` build.
 * @module
 */

export {
  createTestApp,
  type CreateTestAppOptions,
  type LoginAsOptions,
  type TestAi,
  type TestApi,
  type TestApiCall,
  type TestApp,
  type TestAuth,
  type TestCallOptions,
  type TestChannels,
  type TestClock,
  type TestCron,
  type TestEffects,
  type TestLiveHandlers,
  type TestLiveUnsubscribe,
  type TestSignals,
  type TestUser,
} from "./test/create-test-app.ts";