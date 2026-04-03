// ─────────────────────────────────────────────────────────────
// ENUMS / UNIONS
// ─────────────────────────────────────────────────────────────

export type Tier = 'FREE' | 'PRO' | 'PREMIUM' | 'VIP' | 'LEGACY';

export type MainCourse = 'MBBS' | 'NEET';

export type SubCourse = 'FMGE' | 'NEXT' | 'NEET_UG' | 'NEET_PG';

export type ExamType = 'MOCK' | 'SUBJECT_WISE' | 'PYQ';

export type ExamStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export type Platform = 'IOS' | 'ANDROID' | 'WEB';

export type AIExpertise =
  | 'ANATOMY_EXPERT'
  | 'PHARMACOLOGY_GUIDE'
  | 'FINAL_YEAR_MENTOR'
  | 'CLINICAL_CASE_ASSISTANT'
  | 'RAPID_REVISION_BOT'
  | 'NEXT_COACH'
  | 'GENERAL_ASSISTANT';

// ─────────────────────────────────────────────────────────────
// USER
// ─────────────────────────────────────────────────────────────

export interface User {
  userId: string;             // Cognito sub
  fullName: string;
  email: string;
  phone?: string;
  college?: string;
  countryOfResidence?: string;
  countryOfStudy?: string;
  yearOfStudy?: number;       // 1–7
  tier: Tier;
  mainCourse?: MainCourse;
  subCourse?: SubCourse;
  isLegacy: boolean;
  profileCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

// Sent by client when completing profile after first login
export interface CompleteProfileInput {
  college: string;
  countryOfResidence: string;
  countryOfStudy: string;
  yearOfStudy: number;
  mainCourse: MainCourse;
  subCourse: SubCourse;
}

// ─────────────────────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────────────────────

export interface Course {
  courseId: string;
  name: string;
  type: 'MAIN' | 'SUB';
  parentCourseId?: string;
  isActive: boolean;
  displayOrder: number;
}

export interface Subject {
  subjectId: string;
  courseId: string;
  name: string;
  iconUrl?: string;
  isActive: boolean;
  displayOrder: number;
}

export interface Chapter {
  chapterId: string;
  subjectId: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// QUESTION BANK
// ─────────────────────────────────────────────────────────────

export interface QuestionOption {
  text?: string;
  imageUrl?: string;
  isCorrect: boolean;
}

export interface AnswerImage {
  url: string;
  caption?: string;
}

export interface Question {
  questionId: string;
  questionSetId: string;
  questionText: string;
  questionImageUrl?: string;
  options: QuestionOption[];    // up to 6 (text, image, or mixed)
  answerDescription?: string;
  answerImages?: AnswerImage[]; // up to 3
  isActive: boolean;
}

export interface QuestionSet {
  questionSetId: string;
  chapterId: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
}

// ─────────────────────────────────────────────────────────────
// EXAMS / TESTS
// ─────────────────────────────────────────────────────────────

// Stored in DynamoDB ExamSessions table
export interface ExamSession {
  userId: string;
  examId: string;
  type: ExamType;
  questionIds: string[];
  answers: Record<string, number>; // questionId → chosen option index
  score?: number;
  totalQuestions: number;
  status: ExamStatus;
  startedAt: string;
  completedAt?: string;
  expiresAt: number;               // Unix epoch (DynamoDB TTL)
}

// ─────────────────────────────────────────────────────────────
// NOTES (Article View)
// ─────────────────────────────────────────────────────────────

export interface NoteSection {
  sectionId: string;
  sectionNumber: number;
  title: string;
  content?: string;
  imageUrl?: string;
  imageCaption?: string;
}

export interface Note {
  noteId: string;
  chapterId: string;
  title: string;
  sections: NoteSection[];
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// ONE LINERS
// ─────────────────────────────────────────────────────────────

// Stored in DynamoDB OneLinerProgress (userId + oneLinerId) for user state
export interface OneLiner {
  oneLinerId: string;
  subjectId: string;
  chapterId?: string;
  question: string;
  answer: string;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// FLASHCARDS
// ─────────────────────────────────────────────────────────────

// User-created decks
export interface FlashcardDeck {
  deckId: string;
  userId: string;
  name: string;
  topic?: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Flashcard {
  cardId: string;
  deckId: string;
  front: string;
  back: string;
  displayOrder: number;
  createdAt: string;
}

// Stored in DynamoDB FlashcardProgress (userId + cardId) for review state
export interface FlashcardProgress {
  userId: string;
  cardId: string;
  known: boolean;
  reviewedAt: string;
}

// Medmelo library decks (admin-managed, visual images)
export interface LibraryFlashcardDeck {
  deckId: string;
  subjectId: string;
  name: string;
  coverImageUrl?: string;
  cardCount: number;
  isActive: boolean;
  displayOrder: number;
}

export interface LibraryFlashcard {
  cardId: string;
  deckId: string;
  front: string;
  back: string;
  imageUrl?: string;
  displayOrder: number;
}

// ─────────────────────────────────────────────────────────────
// CASE STUDIES (Flashcard model)
// ─────────────────────────────────────────────────────────────

export interface CaseStudy {
  caseId: string;
  subjectId: string;
  topicName: string;
  title: string;
  subtitle?: string;
  subtitleText?: string;
  subtitle2?: string;
  subtitleText2?: string;
  subtitle3?: string;
  subtitleText3?: string;
  images?: Array<{ url: string; caption?: string }>;
  imageText?: string;
  // Answer section
  answerTitle?: string;
  answerTitleText?: string;
  answerImageUrl?: string;
  answerImageText?: string;
  answerSubtitle?: string;          // highlighted box
  answerSubtitleText?: string;
  answerSubtitle2?: string;         // highlighted box
  answerSubtitle2Text?: string;
  isActive: boolean;
  displayOrder: number;
}

// ─────────────────────────────────────────────────────────────
// VISUAL MNEMONICS
// ─────────────────────────────────────────────────────────────

export interface Mnemonic {
  mnemonicId: string;
  subjectId: string;
  title: string;
  imageUrl: string;
  description?: string;
  isActive: boolean;
  displayOrder: number;
}

// ─────────────────────────────────────────────────────────────
// E-BOOKS
// ─────────────────────────────────────────────────────────────

export interface Ebook {
  ebookId: string;
  subjectId: string;
  title: string;
  coverImageUrl?: string;
  fileUrl: string;
  priceInr: number;
  isFreeWithPremium: boolean;
  isActive: boolean;
}

export interface UserEbook {
  userId: string;
  ebookId: string;
  purchasedAt: string;
}

// ─────────────────────────────────────────────────────────────
// VIDEOS
// ─────────────────────────────────────────────────────────────

export interface Video {
  videoId: string;
  chapterId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  minTier: Tier;
  displayOrder: number;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// MELO AI
// ─────────────────────────────────────────────────────────────

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AIConversation {
  conversationId: string;
  userId: string;
  subjectId?: string;
  expertise: AIExpertise;
  messages: AIMessage[];
  createdAt: string;
  updatedAt: string;
}

// Stored in Aurora — daily quota per user
export interface AIQuota {
  userId: string;
  queriesUsedToday: number;
  lastResetDate: string; // YYYY-MM-DD
  totalQueriesAllTime: number;
}

// ─────────────────────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────

export interface Subscription {
  subscriptionId: string;
  userId: string;
  tier: Exclude<Tier, 'FREE'>;
  platform: Platform;
  platformTransactionId?: string;
  promoCode?: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  freeEbookCredits: number; // Premium gets 3
  createdAt: string;
}

export interface PromoCode {
  code: string;
  discountPercent: number;
  maxUses?: number;
  usesCount: number;
  validFrom: string;
  validUntil?: string;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// BANNERS & APP FEATURES (admin-managed home screen)
// ─────────────────────────────────────────────────────────────

export interface Banner {
  bannerId: string;
  imageUrl: string;
  externalLink?: string;
  isActive: boolean;
  displayOrder: number;
}

export interface AppFeature {
  featureId: string;
  name: string;
  description?: string;
  iconUrl?: string;
  routeKey: string;
  isLive: boolean;
  displayOrder: number;
}

// ─────────────────────────────────────────────────────────────
// DONATIONS
// ─────────────────────────────────────────────────────────────

export interface Donation {
  donationId: string;
  userId?: string;
  amountInr: number; // min ₹1
  paymentId?: string;
  donatedAt: string;
}

// ─────────────────────────────────────────────────────────────
// API GATEWAY
// ─────────────────────────────────────────────────────────────

// Typed API Gateway HTTP v2 event
export interface ApiEvent {
  routeKey: string;
  rawPath: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          sub: string;
          email: string;
          'cognito:username': string;
        };
      };
    };
    http: {
      method: string;
      path: string;
    };
  };
}

export interface ApiResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

// Extracted from Cognito JWT — passed through middleware to handlers
export interface AuthContext {
  userId: string;  // Cognito sub
  email: string;
  tier: Tier;
  isLegacy: boolean;
}
