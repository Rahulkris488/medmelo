import type { Tier, AIExpertise } from './types';

// ─────────────────────────────────────────────────────────────
// TIER HIERARCHY
// Higher number = higher access level
// Used to compare tiers: TIER_RANK[user.tier] >= TIER_RANK['PREMIUM']
// ─────────────────────────────────────────────────────────────
export const TIER_RANK: Record<Tier, number> = {
  FREE:    0,
  PRO:     1,
  VIP:     2,
  PREMIUM: 3,
  LEGACY:  4,
};

// ─────────────────────────────────────────────────────────────
// MELO AI QUOTA
// Number of AI queries allowed per day per tier
// Infinity = unlimited (PREMIUM and above)
// ─────────────────────────────────────────────────────────────
export const AI_DAILY_LIMIT: Record<Tier, number> = {
  FREE:    3,
  PRO:     20,
  PREMIUM: Infinity,
  VIP:     Infinity,
  LEGACY:  Infinity,
};

// ─────────────────────────────────────────────────────────────
// PREMIUM PERKS
// ─────────────────────────────────────────────────────────────
export const FREE_EBOOKS_WITH_PREMIUM = 3;
export const LEGACY_MEMBER_CAP        = 1000; // first 1,000 subscribers only

// ─────────────────────────────────────────────────────────────
// AI BOT SYSTEM PROMPTS
// Each expertise maps to a system prompt sent to ChatGPT-4o
// ─────────────────────────────────────────────────────────────
export const AI_SYSTEM_PROMPTS: Record<AIExpertise, string> = {
  ANATOMY_EXPERT: `You are an expert anatomy tutor for medical students preparing for MBBS, FMGE, and NEXT exams.
Explain anatomical structures clearly using clinical relevance, mnemonics, and spatial reasoning.
Keep answers concise and exam-focused. Use bullet points where helpful.`,

  PHARMACOLOGY_GUIDE: `You are a pharmacology guide for medical students preparing for MBBS, FMGE, and NEXT exams.
Focus on drug mechanisms, classifications, side effects, and clinical uses.
Use tables and comparisons when comparing drug classes. Keep it exam-ready.`,

  FINAL_YEAR_MENTOR: `You are a final year MBBS mentor helping students prepare for university exams and NEXT.
Help with long cases, short cases, viva questions, and clinical approach.
Be practical and focus on what examiners actually ask.`,

  CLINICAL_CASE_ASSISTANT: `You are a clinical case discussion assistant for medical students and house surgeons.
Guide students through case presentations: history, examination findings, differential diagnoses, investigations, and management.
Think step by step like a clinician.`,

  RAPID_REVISION_BOT: `You are a rapid revision bot for medical exams.
Give short, high-yield, point-wise answers. No long explanations.
Focus on facts, one-liners, and frequently tested exam points.
Format: bullet points only.`,

  NEXT_COACH: `You are a NEXT exam coach helping MBBS students prepare for the National Exit Test.
Focus on NEXT-specific pattern: clinical scenarios, reasoning-based questions, and integrated medicine.
Explain the clinical reasoning behind answers, not just facts.`,

  GENERAL_ASSISTANT: `You are a helpful medical education assistant for students on the Medmelo app.
Answer questions related to medical studies, exam preparation, and learning strategies.
Be friendly, concise, and accurate.`,
};

// ─────────────────────────────────────────────────────────────
// API ROUTE PREFIXES
// Matches the routes defined in the API Gateway (api-stack.ts)
// ─────────────────────────────────────────────────────────────
export const ROUTES = {
  CORE:  '/api/v1/core',
  EXAM:  '/api/v1/exam',
  ADMIN: '/api/v1/admin',
  MEDIA: '/api/v1/media',
} as const;

// ─────────────────────────────────────────────────────────────
// REDIS KEY PREFIXES
// Consistent naming for all Redis cache keys
// ─────────────────────────────────────────────────────────────
export const REDIS_KEYS = {
  user:        (userId: string)    => `user:${userId}`,
  aiQuota:     (userId: string)    => `ai_quota:${userId}`,
  subjects:    (courseId: string)  => `subjects:${courseId}`,
  chapters:    (subjectId: string) => `chapters:${subjectId}`,
  questionSet: (setId: string)     => `qset:${setId}`,
  banners:     ()                  => `banners`,
  appFeatures: ()                  => `app_features`,
} as const;

// ─────────────────────────────────────────────────────────────
// REDIS TTLs (in seconds)
// ─────────────────────────────────────────────────────────────
export const REDIS_TTL = {
  USER:         300,    // 5 min  — user profile cache
  SUBJECTS:     3600,   // 1 hour — course content rarely changes
  CHAPTERS:     3600,   // 1 hour
  QUESTION_SET: 1800,   // 30 min
  BANNERS:      600,    // 10 min — admin can update frequently
  APP_FEATURES: 600,    // 10 min
  AI_QUOTA:     86400,  // 24 hours — resets daily
} as const;

// ─────────────────────────────────────────────────────────────
// SECRETS MANAGER KEY
// ─────────────────────────────────────────────────────────────
export const SECRETS = {
  AURORA: 'medmelo/aurora/credentials',
} as const;
