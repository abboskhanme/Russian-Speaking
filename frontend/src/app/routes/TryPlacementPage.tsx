/**
 * TryPlacementPage (`/try`) — the PUBLIC, auth-less "try before you register" level test. Renders the
 * shared PlacementScreen in guest mode: it calls the `/api/guest/placement/*` endpoints (no token),
 * sets no placed flag, and at the result nudges the visitor to sign up. Reachable while logged out
 * (linked from the login/register screens); NOT wrapped by RequireAuth.
 */
import PlacementScreen from "../../screens/placement/PlacementScreen";

export default function TryPlacementPage() {
  return <PlacementScreen mode="guest" />;
}
