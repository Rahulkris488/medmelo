import { query, queryOne } from '../db/client';
import { cacheGet, cacheSet } from '../db/redis';
import { buildAuthContext } from '../middleware/auth';
import { hasTier } from '../middleware/tier';
import { REDIS_KEYS, REDIS_TTL } from '../../shared/constants';
import { parseBody } from '../../shared/sanitize';
import { ok } from '../../shared/response';
import { Errors } from '../../shared/errors';
import { createLogger, toResponse } from '../../shared/logger';
import type { ApiEvent, ApiResponse, Question, QuestionSet, QuestionOption } from '../../shared/types';

const log = createLogger('qbank');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const extractUUID = (params: Record<string, string> | undefined, key: string): string => {
  const value = params?.[key];
  if (!value || typeof value !== 'string') throw Errors.badRequest(`Missing path parameter: ${key}`);
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) {
    throw Errors.badRequest(`Invalid ${key} format`);
  }
  return trimmed;
};

// Strips answer details from questions for free users
// Free users see questions + options but not answer description or images
const applyTierGate = (questions: Question[], isPremiumUser: boolean): Question[] => {
  if (isPremiumUser) return questions;
  return questions.map(q => ({
    ...q,
    answerDescription: undefined,
    answerImages:      undefined,
  }));
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/qbank/chapters/:chapterId/sets
// Returns all question sets for a chapter.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   chapterId validated as strict UUID ✅
// - [AUTHZ] Chapter verified to belong to user's enrolled sub-course ✅
// - [CACHE] Cached per chapter — same for all users ✅
// ─────────────────────────────────────────────────────────────

export const getQuestionSets = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth      = await buildAuthContext(event);
    const chapterId = extractUUID(event.pathParameters, 'chapterId');

    // Verify chapter exists and belongs to user's enrolled course
    const chapter = await queryOne<{ subjectId: string; courseId: string }>(
      `SELECT c.subject_id AS "subjectId", s.course_id AS "courseId"
       FROM chapters c
       JOIN subjects s ON s.subject_id = c.subject_id
       WHERE c.chapter_id = $1 AND c.is_active = TRUE`,
      [chapterId],
    );

    if (!chapter) throw Errors.notFound('Chapter');

    // Enforce course access for profile-completed users
    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && chapter.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    const cacheKey = `qsets:${chapterId}`;
    const cached   = await cacheGet<QuestionSet[]>(cacheKey);
    if (cached) return ok(cached);

    const sets = await query<QuestionSet>(
      `SELECT
         question_set_id AS "questionSetId",
         chapter_id      AS "chapterId",
         name,
         display_order   AS "displayOrder"
       FROM question_sets
       WHERE chapter_id = $1 AND is_active = TRUE
       ORDER BY display_order ASC`,
      [chapterId],
    );

    await cacheSet(cacheKey, sets, REDIS_TTL.QUESTION_SET);
    return ok(sets);
  } catch (err) {
    return toResponse(err, { handler: 'getQuestionSets' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/qbank/sets/:setId/questions
// Returns all questions in a set.
// Free users: questions + options only.
// Pro and above: questions + options + answer explanation + answer images.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   setId validated as strict UUID ✅
// - [AUTHZ] Question set verified to belong to user's enrolled course ✅
// - [TIER]  Answer details stripped for free users — not blocked, just filtered ✅
// - [DATA]  options JSONB parsed and validated — malformed DB data handled ✅
// - [CACHE] Cached per set globally — tier filtering applied after cache read ✅
// ─────────────────────────────────────────────────────────────

export const getQuestions = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth  = await buildAuthContext(event);
    const setId = extractUUID(event.pathParameters, 'setId');

    // Verify set exists and belongs to user's enrolled course
    const set = await queryOne<{ chapterId: string; courseId: string }>(
      `SELECT qs.chapter_id AS "chapterId", s.course_id AS "courseId"
       FROM question_sets qs
       JOIN chapters c  ON c.chapter_id  = qs.chapter_id
       JOIN subjects s  ON s.subject_id  = c.subject_id
       WHERE qs.question_set_id = $1 AND qs.is_active = TRUE`,
      [setId],
    );

    if (!set) throw Errors.notFound('Question set');

    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && set.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    // Cache raw questions (with full answer data) — tier filtering applied after
    const cacheKey = REDIS_KEYS.questionSet(setId);
    let questions  = await cacheGet<Question[]>(cacheKey);

    if (!questions) {
      questions = await query<Question>(
        `SELECT
           question_id         AS "questionId",
           question_set_id     AS "questionSetId",
           question_text       AS "questionText",
           question_image_url  AS "questionImageUrl",
           options,
           answer_description  AS "answerDescription",
           answer_images       AS "answerImages"
         FROM questions
         WHERE question_set_id = $1 AND is_active = TRUE
         ORDER BY created_at ASC`,
        [setId],
      );

      // Validate options shape from DB — guards against malformed content data
      questions = questions.filter(q => {
        if (!Array.isArray(q.options) || q.options.length === 0 || q.options.length > 6) {
          log.warn('question has invalid options, skipping', { questionId: q.questionId });
          return false;
        }
        const hasCorrect = (q.options as QuestionOption[]).some(o => o.isCorrect === true);
        if (!hasCorrect) {
          log.warn('question has no correct option, skipping', { questionId: q.questionId });
          return false;
        }
        return true;
      });

      await cacheSet(cacheKey, questions, REDIS_TTL.QUESTION_SET);
    }

    // Apply tier gate — strips answer details for free users
    const isPro = hasTier(auth, 'PRO');
    const result = applyTierGate(questions, isPro);

    return ok({ setId, questions: result, total: result.length });
  } catch (err) {
    return toResponse(err, { handler: 'getQuestions' });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/core/qbank/sets/:setId/submit
// User submits answers for a question set — gets score + correct answers.
//
// Body: { answers: { [questionId]: number } }  ← option index (0-based)
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   setId validated as strict UUID ✅
// - [INPUT] answers validated: must be object, keys must be valid UUIDs,
//           values must be integers 0–5 (max 6 options) ✅
// - [INPUT] Max 100 answers per submission — prevents huge payload abuse ✅
// - [AUTHZ] Question IDs verified against the set in DB — prevents answer injection
//           (user cannot submit answers for questions not in this set) ✅
// - [IDOR]  Score returned to submitting user only — userId from JWT ✅
// - [LOGIC] Score computed server-side — client cannot fake correct answers ✅
// ─────────────────────────────────────────────────────────────

export const submitAnswers = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth  = await buildAuthContext(event);
    const setId = extractUUID(event.pathParameters, 'setId');

    const body = parseBody<{ answers: Record<string, unknown> }>(event.body);

    // answers must be a plain object
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
      throw Errors.badRequest('answers must be an object of { questionId: optionIndex }');
    }

    const entries = Object.entries(body.answers);

    // Prevent abuse via huge submission
    if (entries.length === 0)   throw Errors.badRequest('answers cannot be empty');
    if (entries.length > 100)   throw Errors.badRequest('Too many answers in one submission');

    // Validate each key is a UUID and each value is an integer 0–5
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const answers: Record<string, number> = {};

    for (const [qId, optIdx] of entries) {
      if (!UUID_RE.test(qId.trim().toLowerCase())) {
        throw Errors.badRequest(`Invalid question ID format: ${qId}`);
      }
      if (typeof optIdx !== 'number' || !Number.isInteger(optIdx) || optIdx < 0 || optIdx > 5) {
        throw Errors.badRequest(`Answer for question ${qId} must be an integer between 0 and 5`);
      }
      answers[qId.toLowerCase()] = optIdx;
    }

    // Fetch questions from DB (not cache) — authoritative source for scoring
    const questions = await query<{ questionId: string; options: QuestionOption[] }>(
      `SELECT question_id AS "questionId", options
       FROM questions
       WHERE question_set_id = $1 AND is_active = TRUE`,
      [setId],
    );

    if (questions.length === 0) throw Errors.notFound('Question set');

    // Verify submitted question IDs all belong to this set — prevent answer injection
    const validIds = new Set(questions.map(q => q.questionId));
    for (const qId of Object.keys(answers)) {
      if (!validIds.has(qId)) {
        throw Errors.badRequest(`Question ${qId} does not belong to this set`);
      }
    }

    // Grade server-side — client cannot manipulate correct answers
    let correct = 0;
    const results = questions.map(q => {
      const submitted   = answers[q.questionId];
      const correctIdx  = (q.options as QuestionOption[]).findIndex(o => o.isCorrect === true);
      const isCorrect   = submitted !== undefined && submitted === correctIdx;
      if (isCorrect) correct++;

      return {
        questionId:   q.questionId,
        submitted:    submitted ?? null,
        correctIndex: correctIdx,
        isCorrect,
      };
    });

    const total   = questions.length;
    const score   = Math.round((correct / total) * 100);

    log.info('qbank submitted', { userId: auth.userId, setId, score, correct, total });

    return ok({ setId, score, correct, total, results });
  } catch (err) {
    return toResponse(err, { handler: 'submitAnswers' });
  }
};
