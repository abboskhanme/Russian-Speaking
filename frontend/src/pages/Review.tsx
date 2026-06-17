import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { ReviewItem } from "../lib/types";
import {
  Card,
  Button,
  Pill,
  Icon,
  Mascot,
  Loading,
} from "../components/govori";

export function Review() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["review"],
    queryFn: async () => (await api.get<ReviewItem[]>("/review")).data,
  });

  const dimLabel = (d: string) =>
    d === "fluency"
      ? t("fluency")
      : d === "lexical"
        ? t("lexical")
        : d === "grammar"
          ? t("grammar")
          : d === "relevance"
            ? t("relevance")
            : d;

  const dimHue = (d: string) =>
    d === "fluency" ? 47 : d === "lexical" ? 80 : d === "grammar" ? 28 : 248;

  const dueCount = data?.length ?? 0;

  return (
    <div className="focus-wrap">
      {/* Gradient intro */}
      <Card
        style={{
          marginBottom: 18,
          background: "linear-gradient(135deg, oklch(0.96 0.04 305), var(--surface))",
          borderColor: "oklch(0.86 0.07 305)",
        }}
      >
        <div className="row gap-4 wrap between">
          <div className="row gap-3">
            <Mascot size={56} mood="thinking" float={false} />
            <div className="col">
              <h3 style={{ fontSize: 19 }}>{t("reviewTitle")}</h3>
              <span style={{ fontSize: 13.5, color: "var(--muted)" }}>{t("reviewHint")}</span>
            </div>
          </div>
          {dueCount > 0 && <Pill hue={305}>{dueCount}</Pill>}
        </div>
      </Card>

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <Mascot size={84} mood="proud" float={false} />
          <p style={{ color: "var(--muted)", fontSize: 15, margin: "8px 0 16px" }}>
            {t("noReviews")}
          </p>
          <Button icon="mic" onClick={() => nav("/questions")}>
            {t("startPracticing")}
          </Button>
        </Card>
      ) : (
        <div className="g2">
          {data.map((r) => {
            const hue = dimHue(r.weakness_dim);
            return (
              <Card key={r.id}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <Pill hue={hue} size="sm">
                    {dimLabel(r.weakness_dim)}
                  </Pill>
                  {r.question_level && (
                    <span
                      className="row gap-1"
                      style={{ fontSize: 12.5, color: "var(--muted)" }}
                    >
                      <Icon name="clock" size={14} />
                      {r.question_level}
                    </span>
                  )}
                </div>
                <h3 style={{ fontSize: 16.5, lineHeight: 1.35 }}>
                  {r.question_title ?? t("weakSpot")}
                </h3>
                {r.question_topic && (
                  <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                    {r.question_topic}
                  </p>
                )}
                <div className="row between" style={{ marginTop: 14 }}>
                  <span className="row gap-1" style={{ fontSize: 12.5, color: "var(--faint)" }}>
                    <Icon name="target" size={14} />
                    {t("weakSpot")}
                  </span>
                  <Button
                    size="sm"
                    icon="refresh"
                    onClick={() => nav(`/questions/${r.question_id}/answer`)}
                  >
                    {t("practiceAgain")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
