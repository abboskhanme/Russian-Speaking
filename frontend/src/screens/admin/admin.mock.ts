import type { AdminStats } from "./AdminDashboardScreen";
import type { AdminPerson } from "./AdminPeopleScreen";
import type { AdminSettings } from "./AdminSettingsScreen";

/**
 * Fixtures for the admin screens — they let each screen render standalone.
 * Nothing the app fetches reads these.
 */

export const mockAdminStats: AdminStats = {
  teachers: 8,
  students: 47,
  questions: 45,
  publishedQuestions: 38,
  submissions: 770,
  evaluatedSubmissions: 768,
};

export const mockAdminTeachers: AdminPerson[] = [
  { id: "t-1", fullName: "Aziz Karimov", contact: "aziz.karimov@govori.uz", meta: "11 vazifa", active: true, ownedCount: 11 },
  { id: "t-2", fullName: "Nodira Tosheva", contact: "nodira.tosheva@govori.uz", meta: "3 vazifa", active: true, ownedCount: 3 },
  // A suspended account: the row says so with a labelled badge, not just a colour.
  { id: "t-3", fullName: "Sherzod Rashidov", contact: "sherzod.rashidov@govori.uz", meta: "3 vazifa", active: false, ownedCount: 3 },
];

export const mockAdminStudents: AdminPerson[] = [
  { id: "s-1", fullName: "Анна Иванова", contact: "+998911002001", meta: "Toshkent · 5 javob", active: true, premium: true, ownedCount: 5 },
  { id: "s-2", fullName: "Дмитрий Смирнов", contact: "+998911002004", meta: "Samarqand · 3 javob", active: true, premium: false, ownedCount: 3 },
  { id: "s-3", fullName: "Елена Кузнецова", contact: "+998911002005", meta: "5 javob", active: false, premium: false, ownedCount: 5 },
];

export const mockAdminSettings: AdminSettings = {
  // Faza 6 switches — mirrored OFF, which is how they actually ship.
  reviewDrillEnabled: false,
  roleplayEnabled: false,
  roleplayMaxTurns: 8,
  roleplayDailyTurns: 24,
  llmProvider: "auto",
  geminiModel: "gemini-2.0-flash",
  knownGeminiModels: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", note: "tez" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "aniqroq" },
  ],
  anthropicModel: "claude-opus-5",
  knownAnthropicModels: [
    { id: "claude-opus-5", label: "Claude Opus 5", note: "eng kuchli" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "arzonroq" },
  ],
  // Claude ships without a key: in the chain it renders as skipped, like any other
  // unconfigured backend.
  anthropicApiKey: { set: false, hint: "" },
  orthoepyEnabled: true,
  azureOpenaiEndpoint: "",
  azureOpenaiDeployment: "",
  azureOpenaiApiVersion: "",
  geminiApiKey: { set: false, hint: "" },
  azureOpenaiApiKey: { set: false, hint: "" },
  azureReady: false,
  activeProvider: "none",
  sttProvider: "auto",
  azureSpeechRegion: "westeurope",
  // A model id that is deliberately NOT in the list below — the field is free text, and
  // the fixture should show the state that used to be unreachable.
  whisperModel: "gpt-4o-transcribe",
  knownWhisperModels: [
    { id: "whisper-1", label: "Whisper v1", note: "Standart transkripsiya modeli." },
    { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini transcribe", note: "Yangiroq; so‘z vaqtlarini qaytarmaydi." },
  ],
  openaiGraderModel: "gpt-4o-mini",
  knownOpenaiModels: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", note: "Arzon va tez." },
    { id: "gpt-4o", label: "GPT-4o", note: "Kuchliroq, qimmatroq." },
  ],
  azureSpeechKey: { set: true, hint: "…a91f" },
  openaiApiKey: { set: false, hint: "" },
  azureSpeechReady: true,
  sttActiveProvider: "azure",
  graderChain: "anthropic,gemini,openai",
  sttChain: "azure,whisper",
  graderBackends: ["anthropic", "gemini", "openai"],
  sttBackends: ["azure", "whisper"],
  readyGraderBackends: [],
  readySttBackends: ["azure"],
  tgSupportUrl: "https://t.me/govori_support",
  tgChannelUrl: "https://t.me/govori_channel",
};
