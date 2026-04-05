import { query, queryOne, withTransaction } from '../db/client';
import { cacheGet, cacheSet } from '../db/redis';
import { buildAuthContext } from '../middleware/auth';
import { dbPut, dbDelete, dbQueryAll, TABLES } from '../db/dynamo';
import { REDIS_TTL } from '../../shared/constants';
import { sanitizeStr, parseBody } from '../../shared/sanitize';
import { ok, created, internalError } from '../../shared/response';
import { Errors } from '../../shared/errors';
import { createLogger, toResponse } from '../../shared/logger';
import type {
  ApiEvent, ApiResponse,
  FlashcardDeck, Flashcard,
  LibraryFlashcardDeck, LibraryFlashcard,
} from '../../shared/types';

const log = createLogger('flashcard');

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
// USER DECK LIMITS
// ─────────────────────────────────────────────────────────────

const MAX_DECKS_PER_USER  = 50;   // prevents hoarding unused decks
const MAX_CARDS_PER_DECK  = 200;  // protects load + DynamoDB progress query size
const DECK_NAME_MIN       = 1;
const DECK_NAME_MAX       = 100;
const TOPIC_MIN           = 1;
const TOPIC_MAX           = 100;
const CARD_FRONT_MIN      = 1;
const CARD_FRONT_MAX      = 500;
const CARD_BACK_MIN       = 1;
const CARD_BACK_MAX       = 500;

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/flashcards/decks
// Returns all decks the authenticated user has created.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [IDOR]  userId from JWT — user can only see their own decks ✅
// - [INJ]   No user input in query — parameterised userId ✅
// ─────────────────────────────────────────────────────────────

export const getMyDecks = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth = await buildAuthContext(event);

    const decks = await query<FlashcardDeck>(
      `SELECT
         deck_id    AS "deckId",
         user_id    AS "userId",
         name,
         topic,
         card_count AS "cardCount",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM flashcard_decks
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [auth.userId],
    );

    return ok(decks);
  } catch (err) {
    return toResponse(err, { handler: 'getMyDecks' });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/core/flashcards/decks
// Creates a new flashcard deck for the authenticated user.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INPUT] name sanitized (length + control chars) ✅
// - [INPUT] topic optional — sanitized if provided ✅
// - [LIMIT] Max 50 decks per user enforced before insert ✅
// - [IDOR]  user_id always from JWT — user cannot create deck for another user ✅
// - [INJ]   All values parameterised ✅
// ─────────────────────────────────────────────────────────────

export const createDeck = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth = await buildAuthContext(event);
    const body = parseBody<{ name: string; topic?: string }>(event.body);

    const name  = sanitizeStr(body.name,  'name',  DECK_NAME_MIN, DECK_NAME_MAX);
    const topic = body.topic
      ? sanitizeStr(body.topic, 'topic', TOPIC_MIN, TOPIC_MAX)
      : null;

    // Enforce per-user deck cap before inserting
    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM flashcard_decks WHERE user_id = $1`,
      [auth.userId],
    );

    if (parseInt(countRow?.count ?? '0', 10) >= MAX_DECKS_PER_USER) {
      throw Errors.badRequest(`You cannot create more than ${MAX_DECKS_PER_USER} decks`);
    }

    const deck = await queryOne<FlashcardDeck>(
      `INSERT INTO flashcard_decks (user_id, name, topic)
       VALUES ($1, $2, $3)
       RETURNING
         deck_id    AS "deckId",
         user_id    AS "userId",
         name,
         topic,
         card_count AS "cardCount",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [auth.userId, name, topic],
    );

    if (!deck) throw Errors.internal();

    log.info('deck created', { userId: auth.userId, deckId: deck.deckId });
    return created(deck);
  } catch (err) {
    return toResponse(err, { handler: 'createDeck' });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/core/flashcards/decks/:deckId
// Deletes a deck and all its cards. Cleans up DynamoDB progress.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   deckId validated as strict UUID ✅
// - [IDOR]  WHERE user_id = $userId — user can only delete their own deck ✅
// - [ATOM]  Aurora: delete cards then deck in one transaction — no orphaned cards ✅
// - [DYNAMO] Progress cleaned up after Aurora confirms — failure logged, not rethrown ✅
//            (orphaned DynamoDB rows are inert — no user-visible impact) ✅
// ─────────────────────────────────────────────────────────────

export const deleteDeck = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth   = await buildAuthContext(event);
    const deckId = extractUUID(event.pathParameters, 'deckId');

    // Fetch card IDs before deletion — needed for DynamoDB cleanup
    const cards = await query<{ cardId: string }>(
      `SELECT card_id AS "cardId" FROM flashcards WHERE deck_id = $1`,
      [deckId],
    );

    await withTransaction(async (client) => {
      // IDOR: only delete if this deck belongs to the authenticated user
      const { rows: [deck] } = await client.query(
        `SELECT deck_id FROM flashcard_decks WHERE deck_id = $1 AND user_id = $2`,
        [deckId, auth.userId],
      );
      if (!deck) throw Errors.notFound('Deck');

      await client.query('DELETE FROM flashcards      WHERE deck_id = $1', [deckId]);
      await client.query('DELETE FROM flashcard_decks WHERE deck_id = $1', [deckId]);
    });

    // Clean up DynamoDB progress for all deleted cards — best effort
    if (cards.length > 0) {
      try {
        await Promise.all(
          cards.map(c => dbDelete(TABLES.FLASHCARD_PROGRESS, { userId: auth.userId, cardId: c.cardId })),
        );
      } catch (dynamoErr) {
        // Orphaned progress rows are invisible to the user — log for ops visibility
        log.error('DynamoDB progress cleanup failed after deck deletion', dynamoErr, {
          userId: auth.userId, deckId,
        });
      }
    }

    log.info('deck deleted', { userId: auth.userId, deckId, cardsDeleted: cards.length });
    return ok({ message: 'Deck deleted' });
  } catch (err) {
    return toResponse(err, { handler: 'deleteDeck' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/flashcards/decks/:deckId/cards
// Returns all cards in a user deck, merged with review progress.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   deckId validated as strict UUID ✅
// - [IDOR]  Deck verified to belong to authenticated user before card fetch ✅
// - [DATA]  Progress fetched from DynamoDB with dbQueryAll — no 1MB truncation ✅
// - [MERGE] Set-based merge — O(n) not O(n²) ✅
// ─────────────────────────────────────────────────────────────

export const getDeckCards = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth   = await buildAuthContext(event);
    const deckId = extractUUID(event.pathParameters, 'deckId');

    // IDOR: verify ownership before returning cards
    const deck = await queryOne<Pick<FlashcardDeck, 'deckId' | 'name' | 'topic' | 'cardCount'>>(
      `SELECT
         deck_id    AS "deckId",
         name,
         topic,
         card_count AS "cardCount"
       FROM flashcard_decks
       WHERE deck_id = $1 AND user_id = $2`,
      [deckId, auth.userId],
    );

    if (!deck) throw Errors.notFound('Deck');

    const cards = await query<Flashcard>(
      `SELECT
         card_id       AS "cardId",
         deck_id       AS "deckId",
         front,
         back,
         display_order AS "displayOrder",
         created_at    AS "createdAt"
       FROM flashcards
       WHERE deck_id = $1
       ORDER BY display_order ASC`,
      [deckId],
    );

    if (cards.length === 0) return ok({ deck, cards: [], total: 0 });

    // Fetch user progress from DynamoDB — paginated fully
    const progressRows = await dbQueryAll<{ userId: string; cardId: string; known: boolean; reviewedAt: string }>(
      {
        TableName:                 TABLES.FLASHCARD_PROGRESS,
        KeyConditionExpression:    'userId = :uid',
        ExpressionAttributeValues: { ':uid': auth.userId },
      },
    );

    // O(1) lookup map — key: cardId, value: { known, reviewedAt }
    const progressMap = new Map(progressRows.map(p => [p.cardId, { known: p.known, reviewedAt: p.reviewedAt }]));

    const result = cards.map(c => ({
      ...c,
      known:      progressMap.get(c.cardId)?.known      ?? null,
      reviewedAt: progressMap.get(c.cardId)?.reviewedAt ?? null,
    }));

    return ok({ deck, cards: result, total: result.length });
  } catch (err) {
    return toResponse(err, { handler: 'getDeckCards' });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/core/flashcards/decks/:deckId/cards
// Adds a new card to a user deck. Increments card_count atomically.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   deckId validated as strict UUID ✅
// - [IDOR]  Deck verified to belong to authenticated user before insert ✅
// - [INPUT] front + back sanitized (length, control chars) ✅
// - [LIMIT] Max 200 cards per deck enforced in transaction ✅
// - [ATOM]  Card insert + card_count increment in one transaction ✅
// ─────────────────────────────────────────────────────────────

export const addCard = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth   = await buildAuthContext(event);
    const deckId = extractUUID(event.pathParameters, 'deckId');
    const body   = parseBody<{ front: string; back: string }>(event.body);

    const front = sanitizeStr(body.front, 'front', CARD_FRONT_MIN, CARD_FRONT_MAX);
    const back  = sanitizeStr(body.back,  'back',  CARD_BACK_MIN,  CARD_BACK_MAX);

    const card = await withTransaction(async (client) => {
      // IDOR: verify deck ownership inside transaction
      const { rows: [deck] } = await client.query(
        `SELECT card_count FROM flashcard_decks WHERE deck_id = $1 AND user_id = $2 FOR UPDATE`,
        [deckId, auth.userId],
      );
      if (!deck) throw Errors.notFound('Deck');

      if (deck.card_count >= MAX_CARDS_PER_DECK) {
        throw Errors.badRequest(`Deck cannot have more than ${MAX_CARDS_PER_DECK} cards`);
      }

      // display_order = current max + 1 (append to end)
      const { rows: [{ maxOrder }] } = await client.query<{ maxOrder: number | null }>(
        `SELECT MAX(display_order) AS "maxOrder" FROM flashcards WHERE deck_id = $1`,
        [deckId],
      );

      const nextOrder = (maxOrder ?? 0) + 1;

      const { rows: [newCard] } = await client.query<Flashcard>(
        `INSERT INTO flashcards (deck_id, front, back, display_order)
         VALUES ($1, $2, $3, $4)
         RETURNING
           card_id       AS "cardId",
           deck_id       AS "deckId",
           front,
           back,
           display_order AS "displayOrder",
           created_at    AS "createdAt"`,
        [deckId, front, back, nextOrder],
      );

      // Increment denormalised counter atomically in same transaction
      await client.query(
        `UPDATE flashcard_decks
         SET card_count = card_count + 1, updated_at = NOW()
         WHERE deck_id = $1`,
        [deckId],
      );

      return newCard;
    });

    log.info('card added', { userId: auth.userId, deckId, cardId: card.cardId });
    return created(card);
  } catch (err) {
    return toResponse(err, { handler: 'addCard' });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/core/flashcards/cards/:cardId
// Removes a single card from a user deck. Decrements card_count atomically.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   cardId validated as strict UUID ✅
// - [IDOR]  Card joined to deck to verify userId ownership — cannot delete another user's card ✅
// - [ATOM]  Card delete + card_count decrement in one transaction ✅
// - [DYNAMO] Progress row deleted after Aurora confirms — failure logged, not rethrown ✅
// ─────────────────────────────────────────────────────────────

export const deleteCard = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth   = await buildAuthContext(event);
    const cardId = extractUUID(event.pathParameters, 'cardId');

    await withTransaction(async (client) => {
      // IDOR: join flashcard → deck → user to verify ownership
      const { rows: [card] } = await client.query(
        `SELECT f.card_id, f.deck_id
         FROM flashcards f
         JOIN flashcard_decks d ON d.deck_id = f.deck_id
         WHERE f.card_id = $1 AND d.user_id = $2`,
        [cardId, auth.userId],
      );
      if (!card) throw Errors.notFound('Card');

      await client.query('DELETE FROM flashcards WHERE card_id = $1', [cardId]);

      // Decrement denormalised counter — floor at 0 for safety
      await client.query(
        `UPDATE flashcard_decks
         SET card_count = GREATEST(card_count - 1, 0), updated_at = NOW()
         WHERE deck_id = $1`,
        [card.deck_id],
      );
    });

    // Clean up DynamoDB progress — best effort
    try {
      await dbDelete(TABLES.FLASHCARD_PROGRESS, { userId: auth.userId, cardId });
    } catch (dynamoErr) {
      log.error('DynamoDB progress cleanup failed after card deletion', dynamoErr, {
        userId: auth.userId, cardId,
      });
    }

    return ok({ message: 'Card deleted' });
  } catch (err) {
    return toResponse(err, { handler: 'deleteCard' });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/core/flashcards/cards/:cardId/review
// Records a known/unknown review result for a card.
// Works for both user-created and library cards.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   cardId validated as strict UUID ✅
// - [INPUT] known must be a boolean — type-checked before write ✅
// - [AUTHZ] Card verified to exist in Aurora — cannot record progress for phantom card ✅
// - [IDOR]  userId always from JWT — user cannot record another user's progress ✅
// - [DATA]  reviewedAt server-set — client cannot forge timestamps ✅
// - [IDEM]  DynamoDB PutItem overwrites — repeat reviews update existing record ✅
// ─────────────────────────────────────────────────────────────

export const reviewCard = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth   = await buildAuthContext(event);
    const cardId = extractUUID(event.pathParameters, 'cardId');

    const body = parseBody<{ known: unknown }>(event.body);

    // Strict boolean check — rejects strings "true"/"false", numbers 0/1
    if (typeof body.known !== 'boolean') {
      throw Errors.badRequest('known must be a boolean');
    }

    // Verify card exists — check user deck first, then library
    const userCard = await queryOne(
      `SELECT card_id FROM flashcards WHERE card_id = $1`,
      [cardId],
    );

    const libraryCard = !userCard
      ? await queryOne(
          `SELECT card_id FROM library_flashcards WHERE card_id = $1`,
          [cardId],
        )
      : null;

    if (!userCard && !libraryCard) throw Errors.notFound('Card');

    // Write progress — PutItem overwrites on repeat review (latest result wins)
    await dbPut(TABLES.FLASHCARD_PROGRESS, {
      userId:     auth.userId,
      cardId,
      known:      body.known,
      reviewedAt: new Date().toISOString(),
    });

    return ok({ cardId, known: body.known });
  } catch (err) {
    return toResponse(err, { handler: 'reviewCard' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/flashcards/library/subjects/:subjectId
// Returns all active library decks for a subject.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   subjectId validated as strict UUID ✅
// - [AUTHZ] Subject's courseId verified against user's enrolled sub-course ✅
// - [CACHE] Library decks cached per subject — same for all users ✅
// - [DATA]  Only active decks returned ✅
// ─────────────────────────────────────────────────────────────

export const getLibraryDecks = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth      = await buildAuthContext(event);
    const subjectId = extractUUID(event.pathParameters, 'subjectId');

    // Verify subject and get courseId for access control
    const subject = await queryOne<{ courseId: string }>(
      `SELECT course_id AS "courseId" FROM subjects WHERE subject_id = $1 AND is_active = TRUE`,
      [subjectId],
    );
    if (!subject) throw Errors.notFound('Subject');

    // Enforce course access for profile-completed users
    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1 AND deleted_at IS NULL AND is_banned = FALSE`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && subject.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    const cacheKey = `lib-decks:subject:${subjectId}`;
    let decks      = await cacheGet<LibraryFlashcardDeck[]>(cacheKey);

    if (!decks) {
      decks = await query<LibraryFlashcardDeck>(
        `SELECT
           deck_id         AS "deckId",
           subject_id      AS "subjectId",
           name,
           cover_image_url AS "coverImageUrl",
           card_count      AS "cardCount",
           display_order   AS "displayOrder"
         FROM library_flashcard_decks
         WHERE subject_id = $1 AND is_active = TRUE
         ORDER BY display_order ASC`,
        [subjectId],
      );

      await cacheSet(cacheKey, decks, REDIS_TTL.SUBJECTS);
    }

    return ok(decks);
  } catch (err) {
    return toResponse(err, { handler: 'getLibraryDecks' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/flashcards/library/decks/:deckId/cards
// Returns all cards in a library deck, merged with user's review progress.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   deckId validated as strict UUID ✅
// - [AUTHZ] Deck's subject → courseId verified against user's enrolled sub-course ✅
// - [CACHE] Library cards cached per deck — same for all users (no progress in cache) ✅
// - [DATA]  User progress fetched from DynamoDB with dbQueryAll — no 1MB truncation ✅
// - [MERGE] Map-based merge — O(n) ✅
// ─────────────────────────────────────────────────────────────

export const getLibraryDeckCards = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth   = await buildAuthContext(event);
    const deckId = extractUUID(event.pathParameters, 'deckId');

    // Verify deck exists and get courseId via subject
    const deck = await queryOne<{ deckId: string; name: string; courseId: string; cardCount: number }>(
      `SELECT
         d.deck_id    AS "deckId",
         d.name,
         d.card_count AS "cardCount",
         s.course_id  AS "courseId"
       FROM library_flashcard_decks d
       JOIN subjects s ON s.subject_id = d.subject_id
       WHERE d.deck_id = $1 AND d.is_active = TRUE`,
      [deckId],
    );

    if (!deck) throw Errors.notFound('Deck');

    // Enforce course access for profile-completed users
    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1 AND deleted_at IS NULL AND is_banned = FALSE`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && deck.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    // Cache library cards — same for all users
    const cacheKey = `lib-cards:deck:${deckId}`;
    let cards      = await cacheGet<LibraryFlashcard[]>(cacheKey);

    if (!cards) {
      cards = await query<LibraryFlashcard>(
        `SELECT
           card_id       AS "cardId",
           deck_id       AS "deckId",
           front,
           back,
           image_url     AS "imageUrl",
           display_order AS "displayOrder"
         FROM library_flashcards
         WHERE deck_id = $1
         ORDER BY display_order ASC`,
        [deckId],
      );

      await cacheSet(cacheKey, cards, REDIS_TTL.SUBJECTS);
    }

    if (cards.length === 0) return ok({ deck, cards: [], total: 0 });

    // Fetch user's review progress — paginated fully
    const progressRows = await dbQueryAll<{ userId: string; cardId: string; known: boolean; reviewedAt: string }>(
      {
        TableName:                 TABLES.FLASHCARD_PROGRESS,
        KeyConditionExpression:    'userId = :uid',
        ExpressionAttributeValues: { ':uid': auth.userId },
      },
    );

    const progressMap = new Map(progressRows.map(p => [p.cardId, { known: p.known, reviewedAt: p.reviewedAt }]));

    const result = cards.map(c => ({
      ...c,
      known:      progressMap.get(c.cardId)?.known      ?? null,
      reviewedAt: progressMap.get(c.cardId)?.reviewedAt ?? null,
    }));

    return ok({ deck, cards: result, total: result.length });
  } catch (err) {
    return toResponse(err, { handler: 'getLibraryDeckCards' });
  }
};
