/**
 * HomePage (`/`) — the real Home, rebuilt to the owner's mockup. Fetches the
 * caller's stats (`/api/profile/stats` → level, streak, today/week practice), the
 * group + teacher (`/api/groups/mine`) and the next assignment
 * (`/api/assignments/mine`), maps them to the presentational HomeScreen, and
 * routes "Boshlash" into Practice. Fault-tolerant: a failed secondary fetch
 * degrades that block, never blanks the page.
 *
 * It is also where a teacher's invite link finishes: `/j/:code` remembers the code
 * (through a sign-in if it has to) and sends the student here, and this page files
 * the join request ONCE before it reads the group state — so the card below shows
 * the outcome (waiting for approval, or already a member). A bad code is said in
 * words, never swallowed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { HomeScreen } from "../../screens/home";
import type { HomeDaily, HomeGroup, HomeStats, HomeToday, HomeUser } from "../../screens/home";
import { endpoints, isApiError } from "../../shared/api";
import { useAuth, useFeatures } from "../../shared/auth";
import { firstName } from "../adapters";
import { takePendingJoin } from "../pendingJoin";
import { PageError, PageLoading } from "../PageState";
import { useNavHandler } from "../nav";

/** Default daily goal in minutes (no per-user goal endpoint yet). */
const DAILY_GOAL_MIN = 5;

/** What filing an invite link's join request came to: null when it went through
 * (the group card itself shows the result), else the i18n key of the problem. */
type JoinOutcome = string | null;

export default function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { daily_five: dailyOn } = useFeatures();
  const navigate = useNavigate();
  const onNavigate = useNavHandler();

  // doneSeconds starts UNKNOWN, not 0, for the same reason: it comes from the same
  // read, and an empty progress bar is the same false claim in a different shape.
  const [today, setToday] = useState<HomeToday>({ goalMinutes: DAILY_GOAL_MIN, doneSeconds: null });
  const [group, setGroup] = useState<HomeGroup | null>(null);
  /** Group the student has asked to join and is waiting on — see HomeScreen's
   * `pendingGroupName`. Only meaningful while `group` is null. */
  const [pendingGroupName, setPendingGroupName] = useState<string | null>(null);
  /**
   * The QISQACHA figures, or `null` when the read failed.
   *
   * `allSettled` was always the right call — one dead section must not blank the
   * page — but the rejected branch used to do NOTHING, which left the initial
   * zeros on screen looking like data. A student with a 40-day streak read "0"
   * during a stats outage as "I lost it". The failure now has a value of its own,
   * and the screen says "I don't know" instead of "you have none".
   */
  const [stats, setStats] = useState<HomeStats | null>(null);
  /** Today's F3 session — null while `daily_five_enabled` is off (never asked
   * for: `useFeatures` says so) and null on any other failure. Both draw Home exactly as it was before F3, so
   * a switched-off feature leaves no mark here at all. */
  const [daily, setDaily] = useState<HomeDaily | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  /** The invite link's problem, if it had one (an i18n key). */
  const [joinNoticeKey, setJoinNoticeKey] = useState<string | null>(null);
  /**
   * The invite link's join, started at most once per mount. A ref, not state, so
   * StrictMode's double-run of the effect below awaits the SAME request instead of
   * finding the code already taken and loading the page before the join landed.
   */
  const pendingJoin = useRef<Promise<JoinOutcome> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    if (!pendingJoin.current) {
      const code = takePendingJoin();
      pendingJoin.current = code
        ? endpoints.joinGroup(code).then(
            (): JoinOutcome => null,
            (e: unknown): JoinOutcome =>
              isApiError(e) && e.status === 404
                ? "home.joinLink.invalid"
                : isApiError(e) && e.status === 0
                  ? "auth.errors.network"
                  : "home.joinLink.failed",
          )
        : Promise.resolve(null);
    }

    // The join first: the group reads below must see its result, or the student
    // who just asked would be shown the join form as if nothing had happened.
    void pendingJoin.current
      .then((outcome) => {
        if (!alive) return;
        if (outcome) setJoinNoticeKey(outcome);
        // Reported once. A later reload (a manual join, a retry) must not bring a
        // dismissed notice back.
        pendingJoin.current = Promise.resolve(null);
      })
      .then(() =>
        // allSettled, not all: one dead section must not blank the page.
        // The daily session is only asked for while the flag is on — reading a 404
        // as "off" put a red console error on every Home load.
        Promise.allSettled([
          endpoints.profileStats(),
          endpoints.myGroups(),
          endpoints.assignmentsMine().catch(() => []),
          endpoints.myJoinRequests().catch(() => []),
          dailyOn ? endpoints.dailySession() : Promise.reject(new Error("daily off")),
        ]),
      )
      .then(([s, g, a, r, d]) => {
        if (!alive) return;

        setDaily(
          d.status === "fulfilled"
            ? {
                total: d.value.steps.length,
                // The warm-up leaves no server-side trace, so the server always
                // reports that one undone. Mid-session Home therefore counts only
                // what the server can observe — it must not claim a step it cannot
                // see. But once the server calls the day COMPLETE, every step it
                // can observe is done, and showing "2 of 3" beside "bajarildi"
                // would contradict itself on the same card.
                done: d.value.completed
                  ? d.value.steps.length
                  : d.value.steps.filter((step) => step.done).length,
                completed: d.value.completed,
                // The drill step is ABSENT on a day with nothing due (never present
                // with a zero), so its presence is the whole test.
                hasDrill: d.value.steps.some((step) => step.kind === "drill"),
              }
            : null,
        );

        if (s.status === "fulfilled") {
          setStats({
            level: s.value.level,
            weekMinutes: Math.round(s.value.week_practice_sec / 60),
            currentStreak: s.value.current_streak,
          });
          setToday({ goalMinutes: DAILY_GOAL_MIN, doneSeconds: s.value.today_practice_sec });
        } else {
          setStats(null);
          setToday({ goalMinutes: DAILY_GOAL_MIN, doneSeconds: null });
        }

        // A student belongs to at most one group in practice; take the first.
        const mine = g.status === "fulfilled" ? g.value[0] : undefined;
        if (mine) {
          const assignments = a.status === "fulfilled" ? a.value : [];
          // The soonest INCOMPLETE assignment: due ones first (earliest due), then undated.
          const pending = assignments
            .filter((x) => !x.completed)
            .sort((x, y) => {
              if (x.due_at && y.due_at) return x.due_at.localeCompare(y.due_at);
              if (x.due_at) return -1;
              if (y.due_at) return 1;
              return x.created_at.localeCompare(y.created_at);
            })[0];
          setGroup({
            teacherName: mine.teacher_name,
            name: mine.name,
            memberCount: mine.member_count,
            nextAssignment: pending
              ? {
                  taskId: pending.question_id,
                  title: pending.question_title ?? "",
                  dueAt: pending.due_at,
                }
              : null,
          });
          setPendingGroupName(null);        // a member — nothing to wait for
        } else {
          setGroup(null);
          // Not a member: are they WAITING on a teacher's approval? Only this
          // tells the group-less state apart from the just-asked state.
          const req = r.status === "fulfilled" ? r.value[0] : undefined;
          setPendingGroupName(req?.group_name ?? null);
        }
      })
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, [reloadKey, dailyOn]);

  const homeUser: HomeUser = useMemo(
    () => ({ name: user ? firstName(user.full_name) : "" }),
    [user],
  );

  // With F3 on, "Boshlash" opens the session it now describes; with it off the CTA
  // keeps going where it has always gone.
  const onStart = useCallback(
    () => navigate(daily ? "/daily" : "/practice"),
    [daily, navigate],
  );

  // Retry just the figures. Re-running the whole page load would throw away the
  // group and assignment blocks that loaded perfectly well, and would flash the
  // full-page spinner to recover one card.
  const onRetryStats = useCallback(() => {
    endpoints
      .profileStats()
      .then((v) => {
        setStats({
          level: v.level,
          weekMinutes: Math.round(v.week_practice_sec / 60),
          currentStreak: v.current_streak,
        });
        setToday({ goalMinutes: DAILY_GOAL_MIN, doneSeconds: v.today_practice_sec });
      })
      // Still unknown. Staying in the failed state is the honest outcome — the
      // alternative is showing zeros again, which is the bug this exists to fix.
      .catch(() => undefined);
  }, []);

  // Join a group by code, then refetch so the "O'QITUVCHINGIZ" block replaces the
  // join form. Errors propagate to NoGroupCard, which surfaces them inline.
  const onJoinGroup = useCallback(async (code: string) => {
    await endpoints.joinGroup(code);
    setJoinNoticeKey(null);
    setReloadKey((k) => k + 1);
  }, []);

  if (loading) return <PageLoading />;
  if (!user) return <PageError onRetry={() => setReloadKey((k) => k + 1)} />;

  return (
    <HomeScreen
      user={homeUser}
      today={today}
      group={group}
      stats={stats}
      onRetryStats={onRetryStats}
      daily={daily}
      onStart={onStart}
      onJoinGroup={onJoinGroup}
      pendingGroupName={pendingGroupName}
      onOpenGroup={() => navigate("/group")}
      onOpenAssignment={(taskId) => navigate(`/task?task=${encodeURIComponent(taskId)}`)}
      joinNotice={joinNoticeKey ? t(joinNoticeKey) : null}
      onDismissJoinNotice={() => setJoinNoticeKey(null)}
      activeNavKey="home"
      onNavigate={onNavigate}
    />
  );
}
