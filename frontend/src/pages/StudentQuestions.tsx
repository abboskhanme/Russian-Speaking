import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { stripHtml } from "../components/RichTextEditor";
import type { Block, BlockRegister, Question, QuestionType } from "../lib/types";
import {
  Card,
  Pill,
  Icon,
  Button,
  PageHead,
  Loading,
  EmptyState,
  fmt,
  bandColor,
  type IconName,
} from "../components/govori";
import { Dropdown, type DropdownOption } from "../components/Dropdown";

const REGISTER_ORDER: BlockRegister[] = ["obychnyy", "zhivoy"];
const REGISTER_KEY: Record<BlockRegister, "regObychnyy" | "regZhivoy"> = {
  obychnyy: "regObychnyy",
  zhivoy: "regZhivoy",
};

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
  const [params, setParams] = useSearchParams();
  const blockId = params.get("block");
  const [level, setLevel] = useState("");
  const [topic, setTopic] = useState("");

  const { data: topics } = useQuery({
    queryKey: ["topics"],
    queryFn: async () => (await api.get<string[]>("/questions/meta/topics")).data,
  });

  // Blocks (track → block overview), shown when not inside a specific block.
  const { data: blocks } = useQuery({
    queryKey: ["blocks"],
    queryFn: async () => (await api.get<Block[]>("/blocks")).data,
  });
  const activeBlock = blocks?.find((b) => b.id === blockId) ?? null;

  const { data, isLoading } = useQuery({
    queryKey: ["questions", "published", level, topic, blockId],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (blockId) qp.block_id = blockId;
      if (level) qp.level = level;
      if (topic) qp.topic = topic;
      return (await api.get<Question[]>("/questions", { params: qp })).data;
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

  // Blocks grouped by track (register), only tracks that have blocks.
  const tracks = REGISTER_ORDER.map((reg) => ({
    reg,
    items: (blocks ?? []).filter((b) => b.register === reg),
  })).filter((tr) => tr.items.length > 0);

  // Inside a block → its tasks; on the overview → only tasks NOT in any block
  // (blocked tasks are reached through their block above).
  const gridTasks = activeBlock ? (data ?? []) : (data ?? []).filter((q) => !q.block_id);

  return (
    <div className="focus-wrap anim-fade-up">
      {activeBlock ? (
        <div className="row between wrap gap-2" style={{ marginBottom: 18 }}>
          <div className="col gap-1">
            <Button variant="ghost" size="sm" icon="chevL" onClick={() => setParams({})}>
              {t("backToBlocks")}
            </Button>
            <h1 style={{ fontSize: 26 }}>{activeBlock.name}</h1>
          </div>
          <Pill hue={activeBlock.register === "zhivoy" ? 305 : 152}>
            {t(REGISTER_KEY[activeBlock.register])}
          </Pill>
        </div>
      ) : (
        <PageHead
          title={t("practice")}
          sub={t("tagline")}
          action={
            <div className="row gap-2 wrap">
              <Dropdown value={level} onChange={setLevel} options={levelOptions} className="w-40" />
              {!!topics?.length && (
                <Dropdown value={topic} onChange={setTopic} options={topicOptions} className="w-48" />
              )}
            </div>
          }
        />
      )}

      {/* Track → block overview (only on the top level, not inside a block) */}
      {!activeBlock && tracks.length > 0 && (
        <div className="col gap-5" style={{ marginBottom: 26 }}>
          {tracks.map((tr) => {
            const hue = tr.reg === "zhivoy" ? 305 : 152;
            return (
              <div key={tr.reg} className="col gap-3">
                <div className="row gap-2" style={{ alignItems: "center" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: `oklch(0.6 0.16 ${hue})` }} />
                  <h2 style={{ fontSize: 20 }}>{t(REGISTER_KEY[tr.reg])}</h2>
                </div>
                <div className="g3">
                  {tr.items.map((b) => (
                    <Card
                      key={b.id}
                      hover
                      onClick={() => setParams({ block: b.id })}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="row between" style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            width: 44, height: 44, borderRadius: 13,
                            background: `oklch(0.94 0.06 ${hue})`, color: `oklch(0.5 0.15 ${hue})`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          <Icon name="layers" size={22} />
                        </div>
                        {b.level && <Pill hue={bandColor(50)} size="sm">{b.level}</Pill>}
                      </div>
                      <h3 style={{ fontSize: 17, marginBottom: 2 }}>{b.name}</h3>
                      <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>
                        {b.task_count} {t("tasksInBlock")}
                      </span>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!activeBlock && tracks.length > 0 && gridTasks.length > 0 && (
        <h2 style={{ fontSize: 20, marginBottom: 14 }}>{t("allTasks")}</h2>
      )}

      {isLoading ? (
        <Loading />
      ) : !gridTasks.length ? (
        // On the overview, blocks alone are enough content — don't nag with an
        // empty state unless there's truly nothing (no blocks and no tasks).
        !activeBlock && tracks.length > 0 ? null : <EmptyState text={t("noQuestions")} />
      ) : (
        <div className="g3">
          {gridTasks.map((q) => {
            const meta = TYPE_META[q.type];
            return (
              <Card
                key={q.id}
                hover
                pad={0}
                onClick={() => nav(`/questions/${q.id}/answer`)}
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
