function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}
function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const env = {
  NODE_ENV:                optional("NODE_ENV",                "development"),
  TELEGRAM_BOT_TOKEN:      required("TELEGRAM_BOT_TOKEN"),
  TELEGRAM_BOT_USERNAME:   optional("TELEGRAM_BOT_USERNAME",   ""),
  // Production webhook — required in prod, ignored in dev
  TELEGRAM_WEBHOOK_URL:    optional("TELEGRAM_WEBHOOK_URL",    ""),
  TELEGRAM_WEBHOOK_SECRET: optional("TELEGRAM_WEBHOOK_SECRET", ""),
  // Port the bot webhook HTTP server listens on in production
  BOT_PORT:                parseInt(optional("BOT_PORT", "3001"), 10),
  MINI_APP_URL:            optional("MINI_APP_URL",            ""),
  LOG_LEVEL:               optional("LOG_LEVEL",               "info"),
  // Telegram admin IDs — comma-separated numeric user IDs for admin bot commands
  TELEGRAM_ADMIN_IDS:      optional("TELEGRAM_ADMIN_IDS",      ""),
  isDev: () => env.NODE_ENV === "development",
} as const;
