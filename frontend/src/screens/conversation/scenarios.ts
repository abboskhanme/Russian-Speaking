/**
 * screens/conversation/scenarios — the Suhbat scenario PRESENTATION FALLBACK.
 *
 * This module used to BE the feature: a deterministic script the browser replayed
 * turn by turn, because there was no backend. Since docs/08 Faza 6.5 the
 * scenarios, the turns and the scores come from `/api/roleplay` (see
 * `roleplayApi.ts`), and the partner's replies are chosen by the AI's judgement
 * of what the student actually said.
 *
 * What is left here is a fallback, and it earns its place twice: the hub grid
 * renders instantly instead of flashing empty while the catalogue loads, and a
 * chat opened while the feature is switched OFF still shows a real title and goal
 * in its header — the API returns no scenario for a feature it will not run, and
 * a header reading "undefined" would make a deliberate state look like a crash.
 * The `turns`/`opening` script is no longer played by anything.
 *
 * The Russian is LITERAL data (never i18n) — the student is practising Russian,
 * so the partner's lines must be real Russian, level-appropriate for each
 * scenario's CEFR band. Only the UI chrome around it goes through i18n
 * (`suhbat.*`).
 */
import type { TFunction } from "i18next";
import type { RoleplayScenario } from "./roleplayApi";

/**
 * The scenario goal line in the interface language. The server row only carries
 * an Uzbek goal (`goal_uz`), which an English or Russian UI used to show as-is
 * (UI audit, 20-). Known slugs are translated under `suhbat.goals.*`; a scenario
 * the bundle has never seen keeps the server line rather than showing a raw key.
 */
export function scenarioGoal(s: Pick<Scenario, "id" | "goalUz">, t: TFunction): string {
  return t(`suhbat.goals.${s.id}`, { defaultValue: s.goalUz });
}

/* -------------------------------------------------------------------------- */
/* Public contract — the SHAPE the AI Suhbat hub grid consumes.               */
/* -------------------------------------------------------------------------- */

/**
 * A Suhbat scenario as shown on the E2 grid tile. This is the exact shape the
 * `ConversationHubScreen` grid renders — kept minimal on purpose so the tile
 * never depends on the (much larger) script payload.
 */
export interface Scenario {
  /** The `slug` of the `scenarios` row — also the `/chat/:id` route param. */
  id: string;
  /** Russian title shown on the tile (literal content, e.g. "В аптеке"). */
  titleRu: string;
  /** Short Uzbek goal line (e.g. "Dori dozasini bilib ol"). */
  goalUz: string;
  /** CEFR level, e.g. "A2". */
  level: string;
  /** Rough duration in minutes for the "~N daq" meta. */
  minutes: number;
  /** Tile tint, mapped to a token by the tile (peach/blue/green/amber). */
  tone: "peach" | "blue" | "green" | "amber";
  /** Decorative emoji from the server, for a scenario the bundle has never seen. */
  icon?: string;
}

/** The tints the tile knows how to paint; anything else falls back to peach. */
const TONES: ReadonlyArray<Scenario["tone"]> = ["peach", "blue", "green", "amber"];

/**
 * One API scenario → the shape the grid and the chat header render.
 *
 * The tone is validated rather than cast: it selects a CSS class, and a value
 * invented by whoever last edited the row would silently render an untinted tile
 * instead of failing anywhere anyone would notice.
 */
export function toScenario(api: RoleplayScenario): Scenario {
  const tone = TONES.find((v) => v === api.tone) ?? "peach";
  return {
    id: api.slug,
    titleRu: api.title_ru,
    goalUz: api.goal_uz,
    level: api.level,
    minutes: api.minutes,
    tone,
    icon: api.icon,
  };
}

/** One scripted exchange: the student's line, then the AI's reply (both RU). */
export interface ScriptedTurn {
  user: string;
  ai: string;
}

/**
 * The FULL scenario record — a superset of {@link Scenario} that also carries the
 * scripted conversation. `SCENARIOS` is typed as this; because it extends
 * `Scenario`, the array is still assignable to `Scenario[]` for the grid prop.
 */
export interface ScenarioScript extends Scenario {
  /** Decorative emoji for the tile / chat header (aria-hidden everywhere). */
  icon: string;
  /** The AI's opening line — seeds the chat before the first user turn (RU). */
  opening: string;
  /** Ordered user→AI turns the stub engine replays, one per "Javob berish" tap. */
  turns: ScriptedTurn[];
  /** Three level-appropriate "useful phrases" (RU) shown on the E4 summary. */
  phrases: string[];
}

/* -------------------------------------------------------------------------- */
/* The four scenarios (mockup order)                                          */
/* -------------------------------------------------------------------------- */

export const SCENARIOS: ScenarioScript[] = [
  {
    id: "pharmacy",
    titleRu: "В аптеке",
    goalUz: "Dori dozasini bilib ol",
    level: "A2",
    minutes: 4,
    tone: "peach",
    icon: "💊",
    opening: "Здравствуйте! Что вам подсказать?",
    turns: [
      {
        user: "Здравствуйте. У меня болит горло. Что можно взять?",
        ai: "Возьмите эти таблетки для горла. Они хорошо помогают.",
      },
      {
        user: "Сколько раз в день их принимать?",
        ai: "Три раза в день, после еды. По одной таблетке.",
      },
      {
        user: "А сколько дней их пить?",
        ai: "Пять дней. Если не станет легче, обратитесь к врачу.",
      },
      {
        user: "Спасибо. Сколько это стоит?",
        ai: "Сорок тысяч сумов. Оплатить можно на кассе.",
      },
    ],
    phrases: [
      "Что можно взять от горла?",
      "Сколько раз в день принимать?",
      "Сколько это стоит?",
    ],
  },
  {
    id: "interview",
    titleRu: "Собеседование",
    goalUz: "O'zingni tanishtir",
    level: "B1",
    minutes: 5,
    tone: "blue",
    icon: "💼",
    opening: "Добрый день! Расскажите немного о себе.",
    turns: [
      {
        user: "Здравствуйте. Меня зовут Азиз, мне двадцать пять лет. Я живу в Ташкенте.",
        ai: "Очень приятно, Азиз. Где вы раньше работали?",
      },
      {
        user: "Последние два года я работал менеджером в торговой компании.",
        ai: "Понятно. Почему вы хотите работать у нас?",
      },
      {
        user: "Мне интересна ваша компания, и я хочу развиваться в этой сфере.",
        ai: "Хорошо. Какие у вас сильные стороны?",
      },
      {
        user: "Я ответственный, быстро учусь и легко работаю в команде.",
        ai: "Отлично. Спасибо, мы свяжемся с вами на этой неделе.",
      },
    ],
    phrases: [
      "Меня зовут … , мне … лет.",
      "Я работал менеджером два года.",
      "Я быстро учусь и работаю в команде.",
    ],
  },
  {
    id: "doctor",
    titleRu: "У врача",
    goalUz: "Shikoyatni tushuntir",
    level: "A2",
    minutes: 4,
    tone: "green",
    icon: "🩺",
    opening: "Здравствуйте! На что жалуетесь?",
    turns: [
      {
        user: "Здравствуйте, доктор. У меня болит голова и температура.",
        ai: "Понятно. Когда это началось?",
      },
      {
        user: "Два дня назад. Ещё у меня кашель.",
        ai: "Горло болит? Давайте посмотрим.",
      },
      {
        user: "Да, немного болит, когда я глотаю.",
        ai: "У вас простуда. Я выпишу вам лекарство.",
      },
      {
        user: "Спасибо. Что мне нужно делать?",
        ai: "Больше отдыхайте, пейте тёплую воду и принимайте лекарство.",
      },
    ],
    phrases: [
      "У меня болит голова.",
      "Это началось два дня назад.",
      "Что мне нужно делать?",
    ],
  },
  {
    id: "taxi",
    titleRu: "В такси",
    goalUz: "Manzilni ayt",
    level: "A1",
    minutes: 3,
    tone: "amber",
    icon: "🚕",
    opening: "Здравствуйте! Куда едем?",
    turns: [
      {
        user: "Здравствуйте. Мне нужно на улицу Навои.",
        ai: "Хорошо. Какой дом?",
      },
      {
        user: "Дом десять. Рядом с аптекой.",
        ai: "Понял. Поехали.",
      },
      {
        user: "Сколько будет стоить?",
        ai: "Двадцать тысяч сумов.",
      },
      {
        user: "Остановите здесь, пожалуйста.",
        ai: "Хорошо, приехали. Всего доброго!",
      },
    ],
    phrases: [
      "Мне нужно на улицу Навои.",
      "Сколько будет стоить?",
      "Остановите здесь, пожалуйста.",
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Free topic — the "Erkin mavzu" card on the AI Suhbat hub                    */
/* -------------------------------------------------------------------------- */

/** The id the free-topic card routes to (`/chat/free`). */
export const FREE_SCENARIO_ID = "free";

/**
 * FREE_SCENARIO — the open-ended "Erkin mavzu" conversation reached from the hub
 * card. It is NOT part of {@link SCENARIOS} (the grid), so it never shows as a
 * tile; the turn engine plays it like any other script. The student still speaks
 * every turn (the `user` lines are placeholders — the transcript shows the voice
 * take, not this text); the AI keeps the exchange going with open questions.
 */
export const FREE_SCENARIO: ScenarioScript = {
  id: FREE_SCENARIO_ID,
  titleRu: "Свободная тема",
  goalUz: "Xohlagan mavzuda gaplash",
  level: "A2",
  minutes: 5,
  tone: "peach",
  icon: "💬",
  opening: "Привет! О чём хочешь поговорить сегодня?",
  turns: [
    { user: "—", ai: "Интересно! Расскажи об этом подробнее." },
    { user: "—", ai: "Понятно. А что тебе в этом нравится больше всего?" },
    { user: "—", ai: "Здорово. А как ты думаешь, что будет дальше?" },
    { user: "—", ai: "Спасибо за разговор! У тебя хорошо получается говорить." },
  ],
  phrases: [
    "Я хочу рассказать о …",
    "Мне это нравится, потому что …",
    "Как ты думаешь?",
  ],
};

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

/** Find a scenario by id (the `/chat/:scenarioId` param). Undefined → redirect. */
export function getScenario(id: string | undefined): ScenarioScript | undefined {
  if (!id) return undefined;
  if (id === FREE_SCENARIO_ID) return FREE_SCENARIO;
  return SCENARIOS.find((s) => s.id === id);
}
