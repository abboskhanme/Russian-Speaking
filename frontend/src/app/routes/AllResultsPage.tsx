/**
 * AllResultsPage (`/results`) — the full "Barcha natijalar" history, reached from
 * Profile → Natijalar and from the task screen when grading outlives its wait.
 *
 * Two reads, merged newest first:
 *   • `GET /api/profile/results?limit=50` — the GRADED attempts, each with its band
 *     and trend (the server computes the trend over the whole ordered set);
 *   • `GET /api/submissions?limit=100` — the student's own attempts in every
 *     status, from which only the ones WITHOUT a score are taken: still grading,
 *     or failed (with the failure's code turned into words).
 * The second read used to be missing, so a failed answer vanished from the
 * history while the Profile went on counting it. It is best-effort: if it fails
 * the graded list still renders. Each row opens the attempt detail (`/results/:id`).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AllResultsScreen } from "../../screens/results";
import type { AllResultsItem } from "../../screens/results";
import { endpoints } from "../../shared/api";
import type { ProfileResultItemResponse, SubmissionResponse } from "../../shared/api";
import { gradingFailureKey } from "../adapters";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** The backend caps `/profile/results` at 50; that's the full graded history for now. */
const MAX_RESULTS = 50;
/** How many of the student's own attempts to scan for the unscored ones. */
const MAX_SUBMISSIONS = 100;

export default function AllResultsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  const [graded, setGraded] = useState<ProfileResultItemResponse[]>([]);
  const [unscored, setUnscored] = useState<SubmissionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);

    Promise.allSettled([
      endpoints.profileResults(MAX_RESULTS),
      endpoints.mySubmissions(MAX_SUBMISSIONS),
    ])
      .then(([r, s]) => {
        if (!alive) return;
        // The graded list is the page; without it there is nothing honest to show.
        if (r.status === "rejected") {
          setError(true);
          return;
        }
        setGraded(r.value);
        setUnscored(
          s.status === "fulfilled"
            ? s.value.filter((x) => x.status !== "done")
            : [],
        );
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (loading) return <PageLoading />;
  if (error) return <PageError onRetry={retry} />;

  // Newest first, compared as TIMES — the two endpoints need not print the same
  // fractional-second precision, and a string sort would then misorder a pair.
  const results: AllResultsItem[] = [
    ...graded.map(
      (r): AllResultsItem => ({
        id: r.id,
        title: r.title,
        status: "graded",
        band: r.band,
        createdAt: r.created_at,
        trend: r.trend,
      }),
    ),
    ...unscored.map(
      (s): AllResultsItem => ({
        id: s.id,
        title: s.question_title ?? t("results.attempt"),
        status: s.status === "failed" ? "failed" : "grading",
        band: null,
        createdAt: s.created_at,
        reason: s.status === "failed" ? t(gradingFailureKey(s.error_message)) : undefined,
      }),
    ),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <AllResultsScreen
      results={results}
      onOpenResult={(id) => navigate(`/results/${id}`)}
      onBack={() => navigate("/profile")}
      onStartPractice={() => navigate("/practice")}
      activeNavKey="profile"
      onNavigate={onNavigate}
    />
  );
}
