/**
 * AllResultsPage (`/results`) — the full "Barcha natijalar" history, reached from
 * Profile → Natijalar. Loads the student's graded attempts (`GET /api/profile/
 * results?limit=50`, newest first, each carrying its submission id) and lets each
 * row open the attempt detail (`/results/:id`).
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AllResultsScreen } from "../../screens/results";
import type { AllResultsItem } from "../../screens/results";
import { endpoints } from "../../shared/api";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** The backend caps `/profile/results` at 50; that's the full history for now. */
const MAX_RESULTS = 50;

export default function AllResultsPage() {
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [results, setResults] = useState<AllResultsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);

    endpoints
      .profileResults(MAX_RESULTS)
      .then((rows) => {
        if (!alive) return;
        setResults(
          rows.map((r) => ({
            id: r.id,
            title: r.title,
            band: r.band,
            createdAt: r.created_at,
            trend: r.trend,
          })),
        );
      })
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (loading) return <PageLoading />;
  if (error) return <PageError onRetry={retry} />;

  return (
    <AllResultsScreen
      results={results}
      onOpenResult={(id) => navigate(`/results/${id}`)}
      onBack={() => navigate("/profile")}
      activeNavKey="profile"
      onNavigate={onNavigate}
    />
  );
}
