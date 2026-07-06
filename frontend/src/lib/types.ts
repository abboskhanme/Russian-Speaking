export type UserRole = "admin" | "teacher" | "student";
export type QuestionType = "text" | "image" | "video";
export type SubmissionStatus = "pending" | "processing" | "done" | "failed";

export type RuStyle = "regular" | "live";

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  telegram: string | null;
  age: number | null;
  region: string | null;
  district: string | null;
  role: UserRole;
  is_active: boolean;
  is_premium: boolean;
  preferred_language: string;
  xp: number;
  daily_goal: number;
  streak_freezes: number;
  current_streak: number;
  longest_streak: number;
  avatar_url: string | null;
}

export interface StudentTask {
  id: string;
  title: string;
  type: QuestionType;
  level: string | null;
  sort_order: number;
  done: boolean;
  locked: boolean;
  premium_locked: boolean;
}

export interface StudentModule {
  id: string;
  name: string;
  topic: string | null;
  level: string | null;
  ru_style: string | null;
  visibility: "public" | "group";
  cover_url: string | null;
  total: number;
  done_count: number;
  next_task_id: string | null;
  tasks: StudentTask[];
}

export interface ModuleStudentProgress {
  student_id: string;
  full_name: string;
  done_count: number;
  total: number;
  percent: number;
  current_task_title: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  full_name: string;
  xp: number;
  weekly_xp: number;
  current_streak: number;
  is_me: boolean;
}

export interface ReviewItem {
  id: string;
  question_id: string;
  question_title: string | null;
  question_topic: string | null;
  question_level: string | null;
  weakness_dim: string;
  due_at: string;
}

export interface Assignment {
  id: string;
  student_id: string;
  student_name: string | null;
  question_id: string;
  question_title: string | null;
  question_topic: string | null;
  question_level: string | null;
  due_at: string | null;
  created_at: string;
  completed: boolean;
  submission_id: string | null;
  overall_band: number | null;
}

export interface ExplainResult {
  explanation: string;
  improved_sentence: string;
}

export interface StudentManage {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_premium: boolean;
  created_at: string;
  submission_count: number;
}

export interface TopicImage {
  id: string;
  url: string;
}

export interface Topic {
  id: string;
  name: string;
  images: TopicImage[];
}

export interface StudentGroupBrief {
  id: string;
  name: string;
  teacher_name: string | null;
}
export interface StudentSubmissionBrief {
  id: string;
  question_title: string | null;
  topic: string | null;
  band: number | null;
  status: string;
  created_at: string;
}
export interface AdminStudentDetail {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  is_premium: boolean;
  xp: number;
  current_streak: number;
  longest_streak: number;
  attempts: number;
  avg_band: number | null;
  best_band: number | null;
  groups: StudentGroupBrief[];
  submissions: StudentSubmissionBrief[];
}
export interface AdminTeacher {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string;
  question_count: number;
}

export interface SecretState {
  set: boolean;
  hint: string;
}

export interface AiSettings {
  llm_provider: string; // auto | azure | gemini
  gemini_model: string;
  azure_openai_endpoint: string;
  azure_openai_deployment: string;
  azure_openai_api_version: string;
  gemini_api_key: SecretState;
  azure_openai_api_key: SecretState;
  azure_ready: boolean;
  active_provider: string;
  // Speech-to-text
  stt_provider: string; // auto | azure | whisper
  azure_speech_region: string;
  whisper_model: string;
  azure_speech_key: SecretState;
  openai_api_key: SecretState;
  azure_speech_ready: boolean;
  stt_active_provider: string;
}

export interface AdminStudent {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_premium: boolean;
  created_at: string;
  submission_count: number;
}

export interface Question {
  id: string;
  teacher_id: string;
  teacher_name: string | null;
  type: QuestionType;
  title: string;
  instruction_text: string | null;
  prompt_text: string;
  media_key: string | null;
  media_url: string | null;
  level: string | null;
  topic: string | null;
  block_id: string | null;
  ru_style: RuStyle | null;
  sort_order: number;
  prep_time_sec: number;
  answer_time_limit_sec: number;
  is_published: boolean;
  is_public: boolean;
  locked?: boolean;
  model_answer_text: string | null;
  created_at: string;
}

export interface QuestionBlock {
  id: string;
  teacher_id: string;
  name: string;
  topic: string | null;
  level: string | null;
  ru_style: RuStyle | null;
  sort_order: number;
  visibility: "public" | "group";
  is_published: boolean;
  cover_key: string | null;
  cover_url: string | null;
  question_count: number;
  created_at: string;
}

export interface OrthoepyError {
  word: string;
  word_with_stress: string;
  correct: string;
  said: string;
  rule_ru: string;
  rule_uz: string;
}

export interface TeacherContact {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  telegram: string | null;
}

export interface Evaluation {
  fluency_score: number;
  lexical_score: number;
  grammar_score: number;
  relevance_score: number | null;
  pronunciation_score: number | null;
  naturalness_score: number | null;
  speech_rate_score: number | null;
  intonation_score: number | null;
  overall_band: number;
  level_score: number | null;
  native_likeness: number | null;
  feedback: {
    summary: string;
    strengths: string[];
    improvements: string[];
    vocabulary_suggestions: string[];
    pronunciation_feedback?: string;
    orthoepy_errors?: OrthoepyError[];
  } | null;
  corrections:
    | { original: string; corrected: string; type: string; explanation: string }[]
    | null;
  explanation: { explanation: string; improved_sentence: string } | null;
}

export interface TranscriptPhoneme {
  phoneme: string;
  accuracy: number | null;
}

export interface TranscriptWord {
  word: string;
  start: number | null;
  end: number | null;
  accuracy: number | null;
  error_type: string | null;
  // Per-sound (letter) accuracy from Azure phoneme-level assessment. Null on the
  // Whisper fallback (no pronunciation assessment).
  phonemes?: TranscriptPhoneme[] | null;
}

export interface ReferenceMatch {
  completeness: number;
  similarity: number;
  matched_words: number;
  reference_words: number;
  spoken_words: number;
  on_topic: boolean;
}

export interface PronunciationScores {
  accuracy: number | null;
  fluency: number | null;
  completeness: number | null;
  prosody: number | null;
  pronunciation: number | null;
  // Present only for shadowing: how well the transcript matched the target.
  reference_match?: ReferenceMatch | null;
  // AI-detected words read AS SPELLED (orthoepy errors).
  orthoepy_errors?: OrthoepyError[] | null;
}

export interface Transcript {
  text: string;
  language: string | null;
  word_timestamps: TranscriptWord[] | null;
  pronunciation: PronunciationScores | null;
}

export interface Submission {
  id: string;
  student_id: string;
  question_id: string | null;
  reference_text: string | null;
  audio_key: string;
  audio_url: string | null;
  audio_duration_sec: number | null;
  status: SubmissionStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  student_name: string | null;
  question_title: string | null;
  question_topic: string | null;
  question_level: string | null;
  model_answer_text: string | null;
  teacher_comment: string | null;
  teacher_band: number | null;
  reviewed_at: string | null;
  transcript: Transcript | null;
  evaluation: Evaluation | null;
}

export interface GroupMember {
  id: string;
  full_name: string;
  email: string;
  is_premium: boolean;
  submission_count: number;
}

export interface Group {
  id: string;
  name: string;
  join_code: string;
  member_count: number;
  teacher_id: string | null;
  teacher_name: string | null;
  created_at: string;
  members?: GroupMember[];
}

export interface MemberStat {
  id: string;
  full_name: string;
  avg_band: number | null;
  attempts: number;
  tasks_done: number;
  tasks_total: number;
  last_activity: string | null;
}

export interface TaskStudent {
  student_id: string;
  full_name: string;
  completed: boolean;
  submission_id: string | null;
  band: number | null;
}

export interface GroupTask {
  question_id: string;
  question_title: string | null;
  question_topic: string | null;
  block_id: string | null;
  block_name: string | null;
  due_at: string | null;
  created_at: string;
  total: number;
  done: number;
  students: TaskStudent[];
}

export interface GroupOverview {
  id: string;
  name: string;
  join_code: string;
  member_count: number;
  avg_band: number | null;
  members: MemberStat[];
  tasks: GroupTask[];
}

export interface GradebookRow {
  student_id: string;
  full_name: string;
  email: string;
  attempts: number;
  avg_band: number | null;
  best_band: number | null;
  last_activity: string | null;
}

export interface Analytics {
  total_submissions: number;
  evaluated: number;
  active_students_7d: number;
  student_count: number;
  averages: {
    fluency: number | null;
    lexical: number | null;
    grammar: number | null;
    relevance: number | null;
    overall: number | null;
  };
  weakest: string | null;
  band_distribution: Record<string, number>;
}

export interface AdminStats {
  teachers: number;
  students: number;
  questions: number;
  published_questions: number;
  submissions: number;
  evaluated_submissions: number;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}
