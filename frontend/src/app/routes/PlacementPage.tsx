/**
 * PlacementPage (`/placement`) — lazy route wrapper around the one-time placement screen. Guarded by
 * RequireAuth (a user only takes placement after signing up). The screen itself fetches the questions,
 * drives the record→grade loop, and routes into the app when done or skipped.
 */
export { default } from "../../screens/placement/PlacementScreen";
