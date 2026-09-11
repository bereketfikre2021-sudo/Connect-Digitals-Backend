/**
 * Telegram admin authorization helper.
 *
 * Authorization is enforced purely server-side using Telegram numeric user IDs
 * listed in the TELEGRAM_ADMIN_IDS environment variable. This is completely
 * independent of the web admin system (AdminUser / Supabase Auth) — it grants
 * access to admin bot commands only.
 *
 * SECURITY:
 *  - Telegram usernames are NOT used — they can be changed at any time.
 *  - The env variable is never sent to any frontend.
 *  - Always call isTelegramAdmin() server-side before executing any privileged action.
 */

import { env } from "./env.js";

/**
 * Parses TELEGRAM_ADMIN_IDS into a Set<number> at module load time.
 * Values that cannot be parsed as positive integers are silently discarded
 * so a misconfigured entry never causes a crash but also never grants access.
 */
function parseAdminIds(raw: string): Set<number> {
  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = parseInt(trimmed, 10);
    if (!isNaN(n) && n > 0) {
      ids.add(n);
    }
  }
  return ids;
}

// Parsed once at startup — the env value never changes at runtime
const ADMIN_IDS: Set<number> = parseAdminIds(env.TELEGRAM_ADMIN_IDS ?? "");

/**
 * Returns true if the given Telegram user ID is in the authorised admin list.
 *
 * @param telegramUserId  Numeric Telegram user ID (number or string accepted).
 */
export function isTelegramAdmin(telegramUserId: number | string): boolean {
  const id = typeof telegramUserId === "string"
    ? parseInt(telegramUserId, 10)
    : telegramUserId;
  if (isNaN(id) || id <= 0) return false;
  return ADMIN_IDS.has(id);
}

/**
 * Returns the parsed Set of admin IDs.
 * Exposed for testing only — never log or send to a client.
 */
export function _getAdminIds(): Set<number> {
  return ADMIN_IDS;
}
