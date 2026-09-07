/**
 * Application-wide constants.
 */

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export const BRAND = {
  name: "Connect Digitals",
  primaryRed: "#EC1C24",
  primaryNavy: "#000F33",
  secondaryGold: "#D4AF37",
  fontHeading: "Space Grotesk",
  fontBody: "Montserrat",
} as const;

// ---------------------------------------------------------------------------
// Order numbering
// ---------------------------------------------------------------------------

/** Prefix for human-readable order numbers, e.g. CD10001 */
export const ORDER_NUMBER_PREFIX = "CD";
export const ORDER_NUMBER_START = 10001;

// ---------------------------------------------------------------------------
// Financial
// ---------------------------------------------------------------------------

/** Currency used throughout the platform */
export const DEFAULT_CURRENCY = "ETB";

/**
 * Wallet and payment amounts are stored as integers representing
 * the smallest denomination (ETB cents — 1 ETB = 100 units).
 */
export const CURRENCY_MULTIPLIER = 100;

/** Minimum deposit amount in ETB cents (50 ETB) */
export const MIN_DEPOSIT_AMOUNT = 5000;

/** Maximum file size for payment screenshots: 10 MB */
export const MAX_PAYMENT_PROOF_SIZE_BYTES = 10 * 1024 * 1024;

/** Accepted MIME types for payment screenshots */
export const ACCEPTED_PROOF_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Maximum age of Telegram initData auth_date before it is considered stale.
 * 86400 seconds = 24 hours.
 */
export const TELEGRAM_AUTH_DATE_MAX_AGE_SECONDS = 86400;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Rate limits (requests per window)
// ---------------------------------------------------------------------------

export const RATE_LIMIT = {
  global: { windowMs: 60_000, max: 100 },
  auth: { windowMs: 60_000, max: 10 },
  fileUpload: { windowMs: 60_000, max: 5 },
  paymentSubmit: { windowMs: 60_000, max: 3 },
} as const;

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** How long (ms) an idempotency key is valid for duplicate detection */
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours


