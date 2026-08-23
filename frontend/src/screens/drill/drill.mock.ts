/**
 * Mock minimal pairs for the standalone demo render and the unit tests.
 *
 * These mirror the SERVER's curated seed (`MinimalPairSeed`), including the IPA
 * arrays and focus indices — the whole point of those numbers is that our own
 * spelling lines up with Azure's segmentation position for position, so a mock
 * that invented its own would exercise a shape the product never produces.
 */
import type { DrillPair } from "./DrillScreen";

export const mockDrillPairs: DrillPair[] = [
  {
    slug: "y-i-myshka",
    contrastRu: "ы / и",
    whyUz:
      "O'zbek tilida «ы» tovushi umuman yo'q, shuning uchun uning o'rniga eng " +
      "yaqin tanish tovush — «и» aytiladi.",
    level: "A1",
    wordA: "мышка",
    wordB: "мишка",
    glossAUz: "sichqoncha",
    glossBUz: "ayiqcha",
    ipaA: ["m", "ɨ", "ʂ", "k", "ə"],
    ipaB: ["mʲ", "i", "ʂ", "k", "ə"],
    focusIndexA: 1,
    focusIndexB: 1,
    attempts: 4,
    correct: 3,
  },
  {
    slug: "hard-soft-byt",
    contrastRu: "б / бь",
    whyUz:
      "Rus tilida undosh «qattiq» yoki «yumshoq» bo'ladi va bu ma'noni " +
      "o'zgartiradi. O'zbek tilida bunday qarama-qarshilik yo'q.",
    level: "A1",
    wordA: "быть",
    wordB: "бить",
    glossAUz: "bo'lmoq",
    glossBUz: "urmoq",
    ipaA: ["b", "ɨ", "tʲ"],
    ipaB: ["bʲ", "i", "tʲ"],
    focusIndexA: 1,
    focusIndexB: 1,
    attempts: 0,
    correct: 0,
  },
  {
    slug: "sh-shch-shchit",
    contrastRu: "ш / щ",
    whyUz:
      "O'zbek tilida «ш» bor, «щ» yo'q — shuning uchun ikkalasi ham «ш» " +
      "bo'lib chiqadi. «щ» yumshoqroq va cho'ziqroq.",
    level: "A1",
    wordA: "шит",
    wordB: "щит",
    glossAUz: "tikilgan",
    glossBUz: "qalqon",
    ipaA: ["ʂ", "ɨ", "t"],
    ipaB: ["ɕː", "i", "t"],
    focusIndexA: 0,
    focusIndexB: 0,
    attempts: 2,
    correct: 0,
  },
];
