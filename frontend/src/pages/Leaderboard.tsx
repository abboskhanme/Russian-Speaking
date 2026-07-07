import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import type { Group, LeaderboardEntry } from "../lib/types";
import {
  Card,
  Avatar,
  Icon,
  SegTabs,
  PageHead,
  Loading,
  EmptyState,
} from "../components/govori";

const MEDAL: Record<number, number> = { 1: 80, 2: 248, 3: 28 }; // medal hues

export function Leaderboard() {
  const { t } = useI18n();
  const [scope, setScope] = useState<"global" | "group">("global");
  // Rank by this week's XP or by all-time XP. Both scopes (global/group) honour it.
  const [period, setPeriod] = useState<"weekly" | "all">("weekly");

  // The student's own groups — drives the group tab (and selector if in several).
  const { data: groups } = useQuery({
    queryKey: ["my-groups"],
    queryFn: async () => (await api.get<Group[]>("/groups/mine")).data,
  });
  const [groupId, setGroupId] = useState<string | null>(null);
  const activeGroupId = groupId ?? groups?.[0]?.id ?? null;

  // Students who haven't joined a group never see group-related UI at all.
  const hasGroups = (groups?.length ?? 0) > 0;
  const inGroupView = hasGroups && scope === "group";
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", inGroupView ? activeGroupId : "global", period],
    enabled: !inGroupView || !!activeGroupId,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (inGroupView) params.set("group_id", activeGroupId!);
      return (await api.get<LeaderboardEntry[]>(`/leaderboard?${params}`)).data;
    },
  });

  return (
    <div className="col gap-5 focus-wrap">
      <PageHead
        title={t("leaderboardTitle")}
        sub={t("leaderboardHint")}
        action={
          hasGroups ? (
            <SegTabs
              value={scope}
              onChange={(id) => setScope(id as "global" | "group")}
              tabs={[
                { id: "global", label: t("ratingGlobal"), icon: "globe" },
                { id: "group", label: t("ratingGroup"), icon: "users" },
              ]}
            />
          ) : undefined
        }
      />

      {/* Period toggle — weekly vs all-time XP. Always available. */}
      <SegTabs
        value={period}
        onChange={(id) => setPeriod(id as "weekly" | "all")}
        tabs={[
          { id: "weekly", label: t("periodWeekly"), icon: "flame" },
          { id: "all", label: t("periodAllTime"), icon: "trophy" },
        ]}
      />

      {/* Group selector — only when the student belongs to more than one group. */}
      {inGroupView && groups && groups.length > 1 && (
        <div className="row wrap gap-2">
          {groups.map((g) => {
            const active = g.id === activeGroupId;
            return (
              <button
                key={g.id}
                onClick={() => setGroupId(g.id)}
                className="tap"
                style={{
                  padding: "7px 14px",
                  borderRadius: "var(--r-pill)",
                  border: "1px solid",
                  borderColor: active ? "transparent" : "var(--line-2)",
                  background: active ? "var(--primary)" : "var(--surface)",
                  color: active ? "#fff" : "var(--ink-soft)",
                  fontWeight: 800,
                  fontFamily: "var(--font-display)",
                  fontSize: 13.5,
                  cursor: "pointer",
                }}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState text={t("noActivity")} />
      ) : (
        <>
          {/* Pinned summary of the student's own standing — shown up top even when
              their row also appears further down (or off-screen) in the full list. */}
          {(() => {
            const me = data.find((e) => e.is_me);
            if (!me) return null;
            return (
              <Card style={{ border: "2px solid var(--primary)", background: "var(--primary-tint)" }}>
                <div className="row gap-3" style={{ padding: "4px 2px" }}>
                  <span
                    style={{
                      width: 30,
                      display: "flex",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontFamily: "var(--font-display)",
                      fontWeight: 900,
                      fontSize: 15,
                      color: "var(--primary-press)",
                    }}
                  >
                    {me.rank}
                  </span>
                  <Avatar name={me.full_name} size={42} />
                  <div className="col grow" style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: "var(--primary-press)", fontWeight: 800, textTransform: "uppercase" }}>
                      {t("yourRank")}
                    </span>
                    <span className="truncate" style={{ fontSize: 15, fontWeight: 800 }}>
                      {me.full_name}
                    </span>
                  </div>
                  <div className="col" style={{ alignItems: "flex-end", flexShrink: 0 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 900,
                        fontSize: 18,
                        color: "var(--primary-press)",
                      }}
                    >
                      {period === "all" ? me.xp : me.weekly_xp}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 700 }}>
                      {period === "all" ? t("allTimeXp") : t("weeklyXp")}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })()}
          <Card>
          <div className="col gap-1">
            {data.map((e) => (
              <div
                key={e.id}
                className="row gap-3"
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--r-sm)",
                  background: e.is_me ? "var(--primary-tint)" : "transparent",
                }}
              >
                <span
                  style={{
                    width: 30,
                    display: "flex",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {MEDAL[e.rank] != null ? (
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: `oklch(0.93 0.08 ${MEDAL[e.rank]})`,
                        color: `oklch(0.5 0.16 ${MEDAL[e.rank]})`,
                      }}
                    >
                      <Icon name="trophy" size={15} />
                    </span>
                  ) : (
                    <span
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 900,
                        fontSize: 15,
                        color: "var(--muted)",
                      }}
                    >
                      {e.rank}
                    </span>
                  )}
                </span>
                <Avatar name={e.full_name} size={42} />
                <div className="col grow" style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ fontSize: 15, fontWeight: 800 }}>
                    {e.full_name}
                    {e.is_me && <span style={{ color: "var(--primary)" }}> ({t("you")})</span>}
                  </span>
                  <span className="row gap-2" style={{ fontSize: 12.5, color: "var(--muted)" }}>
                    <span className="row gap-1">
                      <Icon name="flame" size={13} style={{ color: "oklch(0.65 0.16 28)" }} />
                      {e.current_streak}
                    </span>
                    <span>·</span>
                    <span>
                      {period === "all" ? e.weekly_xp : e.xp} {t("xp")}{" "}
                      {(period === "all" ? t("weeklyXp") : t("allTimeXp")).toLowerCase()}
                    </span>
                  </span>
                </div>
                <div className="col" style={{ alignItems: "flex-end", flexShrink: 0 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 900,
                      fontSize: 18,
                      color: "var(--primary-press)",
                    }}
                  >
                    {period === "all" ? e.xp : e.weekly_xp}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--faint)", fontWeight: 700 }}>
                    {period === "all" ? t("allTimeXp") : t("weeklyXp")}
                  </span>
                </div>
              </div>
            ))}
          </div>
          </Card>
        </>
      )}
    </div>
  );
}
