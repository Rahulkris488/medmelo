import { query, queryOne } from '../db/client';
import { cacheGet, cacheSet } from '../db/redis';
import { buildAuthContext } from '../middleware/auth';
import { REDIS_TTL } from '../../shared/constants';
import { ok } from '../../shared/response';
import { Errors } from '../../shared/errors';
import { createLogger, toResponse } from '../../shared/logger';
import type { ApiEvent, ApiResponse, Note, NoteSection } from '../../shared/types';

const log = createLogger('notes');

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

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/notes/chapters/:chapterId
// Returns list of notes for a chapter (title only — no sections).
// Used to render the notes list screen before user taps into one.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   chapterId validated as strict UUID ✅
// - [AUTHZ] Chapter verified to belong to user's enrolled sub-course ✅
// - [CACHE] Cached per chapter — content-level, same for all users ✅
// - [DATA]  Returns only active notes — inactive notes invisible to users ✅
// ─────────────────────────────────────────────────────────────

export const getNotesByChapter = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth      = await buildAuthContext(event);
    const chapterId = extractUUID(event.pathParameters, 'chapterId');

    // Verify chapter exists and belongs to user's enrolled course
    const chapter = await queryOne<{ courseId: string }>(
      `SELECT s.course_id AS "courseId"
       FROM chapters c
       JOIN subjects s ON s.subject_id = c.subject_id
       WHERE c.chapter_id = $1 AND c.is_active = TRUE`,
      [chapterId],
    );

    if (!chapter) throw Errors.notFound('Chapter');

    // Enforce course access for profile-completed users
    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1 AND deleted_at IS NULL AND is_banned = FALSE`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && chapter.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    const cacheKey = `notes:chapter:${chapterId}`;
    const cached   = await cacheGet<Pick<Note, 'noteId' | 'chapterId' | 'title'>[]>(cacheKey);
    if (cached) return ok(cached);

    const notes = await query<Pick<Note, 'noteId' | 'chapterId' | 'title'>>(
      `SELECT
         note_id    AS "noteId",
         chapter_id AS "chapterId",
         title
       FROM notes
       WHERE chapter_id = $1 AND is_active = TRUE
       ORDER BY display_order ASC`,
      [chapterId],
    );

    await cacheSet(cacheKey, notes, REDIS_TTL.SUBJECTS);
    return ok(notes);
  } catch (err) {
    return toResponse(err, { handler: 'getNotesByChapter' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/notes/:noteId
// Returns a single note with all its sections (article view).
// Sections are the numbered blocks with title, content, image.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   noteId validated as strict UUID ✅
// - [AUTHZ] Note verified to belong to user's enrolled sub-course via chapter → subject → course ✅
// - [DATA]  Sections fetched in display order — consistent render on mobile ✅
// - [DATA]  Empty sections array returned (not error) if note has no sections yet ✅
// - [CACHE] Full note with sections cached — heavy payload, worth caching ✅
// - [INFO]  404 shape consistent — does not reveal whether noteId exists in another course ✅
// ─────────────────────────────────────────────────────────────

export const getNoteById = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth   = await buildAuthContext(event);
    const noteId = extractUUID(event.pathParameters, 'noteId');

    const cacheKey = `notes:${noteId}`;
    const cached   = await cacheGet<Note>(cacheKey);

    if (cached) {
      // Verify course access even on cache hit — prevents cross-course access via cached note
      const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
        `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
         FROM users WHERE user_id = $1 AND deleted_at IS NULL AND is_banned = FALSE`,
        [auth.userId],
      );

      const noteCourseCacheKey = `notes:course:${noteId}`;
      const cachedCourseId     = await cacheGet<string>(noteCourseCacheKey);

      if (user?.profileCompleted && user.subCourse && cachedCourseId && cachedCourseId !== user.subCourse) {
        throw Errors.forbidden('You are not enrolled in this course');
      }

      return ok(cached);
    }

    // Fetch note with its course context for access control
    const noteRow = await queryOne<{ noteId: string; chapterId: string; title: string; courseId: string }>(
      `SELECT
         n.note_id    AS "noteId",
         n.chapter_id AS "chapterId",
         n.title,
         s.course_id  AS "courseId"
       FROM notes n
       JOIN chapters c ON c.chapter_id = n.chapter_id
       JOIN subjects s ON s.subject_id = c.subject_id
       WHERE n.note_id = $1 AND n.is_active = TRUE`,
      [noteId],
    );

    if (!noteRow) throw Errors.notFound('Note');

    // Enforce course access
    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1 AND deleted_at IS NULL AND is_banned = FALSE`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && noteRow.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    // Fetch sections
    const sections = await query<NoteSection>(
      `SELECT
         section_id     AS "sectionId",
         section_number AS "sectionNumber",
         title,
         content,
         image_url      AS "imageUrl",
         image_caption  AS "imageCaption"
       FROM note_sections
       WHERE note_id = $1
       ORDER BY display_order ASC`,
      [noteId],
    );

    const note: Note = {
      noteId:    noteRow.noteId,
      chapterId: noteRow.chapterId,
      title:     noteRow.title,
      sections,
      isActive:  true,
    };

    // Cache the note and its courseId separately for access control on cache hits
    await Promise.all([
      cacheSet(cacheKey,                          note,              REDIS_TTL.SUBJECTS),
      cacheSet(`notes:course:${noteId}`,          noteRow.courseId,  REDIS_TTL.SUBJECTS),
    ]);

    log.info('note fetched', { userId: auth.userId, noteId });
    return ok(note);
  } catch (err) {
    return toResponse(err, { handler: 'getNoteById' });
  }
};
