import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { stripHtml } from "../components/RichTextEditor";
import type { Question, QuestionType } from "../lib/types";
import {
  Card,
  Pill,
  Icon,
  PageHead,
  Loading,
  EmptyState,
  fmt,
  type IconName,
} from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Hue + icon per question type, matching the Govori practice grid. */
const TYPE_META: Record<QuestionType, { hue: number; icon: IconName }> = {
  text: { hue: 47, icon: "message" },
  image: { hue: 152, icon: "eye" },
  video: { hue: 248, icon: "play" },
};

export function StudentQuestions() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [level, setLevel] = useState("");
  const [topic, setTopic] = useState("");
  const [ruStyle, setRuStyle] = useState("");

  const { data: topics } = useQuery({
    queryKey: ["topics"],
    queryFn: async () => (await api.get<string[]>("/questions/meta/topics")).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["questions", "published", level, topic, ruStyle],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (level) params.level = level;
      if (topic) params.topic = topic;
      if (ruStyle) params.ru_style = ruStyle;
      return (await api.get<Question[]>("/questions", { params })).data;
    },
  });

  const levelOptions: DropdownOption<string>[] = [
    { value: "", label: t("allLevels") },
    ...LEVELS.map((l) => ({ value: l, label: l })),
  ];
  const topicOptions: DropdownOption<string>[] = [
    { value: "", label: t("allTopics") },
    ...(topics ?? []).map((tp) => ({ value: tp, label: tp })),
  ];
  const styleOptions: DropdownOption<string>[] = [
    { value: "", label: t("ruStyleAll") },
    { value: "regular", label: t("ruRegular") },
    { value: "live", label: t("ruLive") },
  ];

  return (
    <div className="focus-wrap anim-fade-up">
      <PageHead
        title={t("practice")}
        sub={t("tagline")}
        action={
          <div className="row gap-2 wrap">
            <Dropdown value={ruStyle} onChange={setRuStyle} options={styleOptions} className="w-48" />
            <Dropdown value={level} onChange={setLevel} options={levelOptions} className="w-40" />
            {!!topics?.length && (
              <Dropdown value={topic} onChange={setTopic} options={topicOptions} className="w-48" />
            )}
          </div>
        }
      />

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("noQuestions")} />
      ) : (
        <div className="g3">
          {data.map((q) => {
            const meta = TYPE_META[q.type];
            return (
              <Card
                key={q.id}
                hover
                pad={0}
                onClick={() => nav(q.locked ? "/premium" : `/questions/${q.id}/answer`)}
                style={{ overflow: "hidden" }}
              >
                <div
                  style={{
                    height: 92,
                    background: `linear-gradient(135deg, oklch(0.74 0.13 ${meta.hue}), oklch(0.64 0.17 ${meta.hue}))`,
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 22px",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      right: -20,
                      top: -20,
                      width: 110,
                      height: 110,
                      borderRadius: "50%",
                      background: "oklch(1 0 0 / 0.12)",
                    }}
                  />
                  <div
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 15,
                      background: "oklch(1 0 0 / 0.22)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                    }}
                  >
                    <Icon name={meta.icon} size={25} />
                  </div>
                  {q.locked && (
                    <span
                      className="row gap-1"
                      style={{
                        position: "absolute", top: 12, left: 16,
                        background: "oklch(0.72 0.14 70)", color: "#fff",
                        fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 999,
                        alignItems: "center",
                      }}
                    >
                      <Icon name="star" size={12} /> {t("premium")}
                    </span>
                  )}
                  {q.level && (
                    <span
                      style={{
                        position: "absolute",
                        top: 12,
                        right: 16,
                        fontFamily: "var(--font-display)",
                        fontWeight: 900,
                        fontSize: 28,
                        color: "oklch(1 0 0 / 0.32)",
                      }}
                    >
                      {q.level}
                    </span>
                  )}
                </div>
                <div style={{ padding: 20 }}>
                  <div className="row between gap-2" style={{ marginBottom: 8, alignItems: "flex-start" }}>
                    <span
                      style={{
                        fontWeight: 800,
                        fontFamily: "var(--font-display)",
                        fontSize: 17,
                        lineHeight: 1.3,
                      }}
                    >
                      {q.title}
                    </span>
                    {q.level && (
                      <Pill hue={meta.hue} size="sm">
                        {q.level}
                      </Pill>
                    )}
                  </div>
                  <p
                    style={{
                      color: "var(--muted)",
                      fontSize: 13.5,
                      lineHeight: 1.5,
                      minHeight: 40,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {stripHtml(q.prompt_text)}
                  </p>
                  <div
                    className="row between"
                    style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}
                  >
                    {q.topic ? (
                      <span
                        className="row gap-2"
                        style={{ color: "var(--ink-soft)", fontSize: 13 }}
                      >
                        <Icon name="flag" size={15} />
                        {q.topic}
                      </span>
                    ) : (
                      <span style={{ width: 1 }} />
                    )}
                    <span
                      className="row gap-2"
                      style={{ color: `oklch(0.55 0.15 ${meta.hue})`, fontSize: 13, fontWeight: 800 }}
                    >
                      <Icon name="clock" size={15} />{fmt(q.answer_time_limit_sec || 60)}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
