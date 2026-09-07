/**
 * DEVELOPMENT-ONLY mock authentication helpers.
 *
 * This module is NEVER imported in production — it is only registered
 * when NODE_ENV === "development". The mock user has a stable, clearly
 * labelled Telegram ID that cannot be confused with a real account.
 *
 * DO NOT import this file from any production code path.
 */

import type { TelegramUser } from "./telegram-auth.js";

/** Stable mock Telegram user for local development */
export const DEV_MOCK_TELEGRAM_USER: TelegramUser = {
  id: 999999999,           // Clearly fake — real Telegram IDs don't look like this
  first_name: "[DEV]",
  last_name: "Mock User",
  username: "dev_mock_user",
  language_code: "en",
  is_premium: false,
};

export const DEV_MOCK_AUTH_DATE = new Date();
