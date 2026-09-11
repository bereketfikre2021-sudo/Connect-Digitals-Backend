/**
 * Environment variable loader with validation.
 * Fails fast at startup if required variables are missing.
 */

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

// Some vars are only required when NODE_ENV=production
function requiredInProd(key: string): string {
  const val = process.env[key];
  if (!val && process.env["NODE_ENV"] === "production") {
    throw new Error(`Missing required production environment variable: ${key}`);
  }
  return val ?? "";
}

export const env = {
  NODE_ENV: optional("NODE_ENV", "development"),
  PORT: parseInt(optional("APP_PORT", "3000"), 10),

  // Database — always required
  DATABASE_URL: required("DATABASE_URL"),

  // Telegram — bot token always required (used for notifications even in dev)
  TELEGRAM_BOT_TOKEN:      required("TELEGRAM_BOT_TOKEN"),
  TELEGRAM_BOT_USERNAME:   optional("TELEGRAM_BOT_USERNAME", ""),
  TELEGRAM_WEBHOOK_URL:    optional("TELEGRAM_WEBHOOK_URL",    "").trim(),
  TELEGRAM_WEBHOOK_SECRET: optional("TELEGRAM_WEBHOOK_SECRET", "").trim(),

  // Telegram admin IDs — comma-separated list of Telegram numeric user IDs
  // that are authorized to use admin bot commands (e.g. /broadcast).
  // Example: TELEGRAM_ADMIN_IDS=123456789,987654321
  TELEGRAM_ADMIN_IDS: optional("TELEGRAM_ADMIN_IDS", ""),

  // URLs
  MINI_APP_URL:  optional("MINI_APP_URL",  ""),
  ADMIN_URL:     optional("ADMIN_URL",     ""),

  // CORS — must be set explicitly in production
  CORS_ALLOWED_ORIGINS: optional("CORS_ALLOWED_ORIGINS", "http://localhost:5173"),

  // Supabase — required in production; optional in dev (tests may not need them)
  SUPABASE_URL:              requiredInProd("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: requiredInProd("SUPABASE_SERVICE_ROLE_KEY"),
  SUPABASE_ANON_KEY:         optional("SUPABASE_ANON_KEY", ""),

  // Logging
  LOG_LEVEL: optional("LOG_LEVEL", "info"),

  // Ad provider credentials — all optional, never required at startup
  // Server-side only; never sent to frontend; never logged
  META_ADS_ACCESS_TOKEN:      optional("META_ADS_ACCESS_TOKEN",      ""),
  META_ADS_AD_ACCOUNT_ID:     optional("META_ADS_AD_ACCOUNT_ID",     ""),
  GOOGLE_ADS_DEVELOPER_TOKEN: optional("GOOGLE_ADS_DEVELOPER_TOKEN", ""),
  GOOGLE_ADS_CUSTOMER_ID:     optional("GOOGLE_ADS_CUSTOMER_ID",     ""),
  GOOGLE_ADS_CLIENT_ID:       optional("GOOGLE_ADS_CLIENT_ID",       ""),
  GOOGLE_ADS_CLIENT_SECRET:   optional("GOOGLE_ADS_CLIENT_SECRET",   ""),
  GOOGLE_ADS_REFRESH_TOKEN:   optional("GOOGLE_ADS_REFRESH_TOKEN",   ""),
  TIKTOK_ADS_ACCESS_TOKEN:    optional("TIKTOK_ADS_ACCESS_TOKEN",    ""),
  TIKTOK_ADS_ADVERTISER_ID:   optional("TIKTOK_ADS_ADVERTISER_ID",  ""),

  isDev:  () => env.NODE_ENV === "development",
  isProd: () => env.NODE_ENV === "production",
} as const;
