/**
 * Write-path mutation id header — shared by the kernel HTTP glue and
 * `okengine/client-react` optimistic mutate. Keep this file free of Node
 * APIs so Vite SPAs can import `Can` / `useLiveQuery`.
 */

/** Header echoed into `mutationId` on write-path live-query events. */
export const MUTATION_ID_HEADER = "x-oke-mutation-id";
