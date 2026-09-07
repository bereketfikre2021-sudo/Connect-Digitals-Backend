/**
 * Telegram Mini App initData validation.
 *
 * Implements the official Telegram validation algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * The bot token is only ever used server-side in this file.
 * It is never sent to or accessible from the frontend.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { TELEGRAM_AUTH_DATE_MAX_AGE_SECONDS } from "../shared/index.js";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface ParsedInitData {
  user: TelegramUser;
  auth_date: number;
  hash: string;
  query_id?: string;
  chat_type?: string;
}

export class TelegramAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "TelegramAuthError";
  }
}

/**
 * Validates Telegram initData string and returns parsed fields.
 *
 * @param initData  Raw initData string from window.Telegram.WebApp.initData
 * @param botToken  Bot token — only available server-side
 * @throws TelegramAuthError on invalid or stale data
 */
export function validateInitData(initData: string, botToken: string): ParsedInitData {
  if (!initData || typeof initData !== "string") {
    throw new TelegramAuthError("initData is empty", "EMPTY_INIT_DATA");
  }

  // Parse the query string
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    throw new TelegramAuthError("Missing hash in initData", "MISSING_HASH");
  }

  // Build the data-check string:
  // All keys EXCEPT "hash", sorted alphabetically, joined with \n
  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  // Derive the secret key: HMAC-SHA256("WebAppData", botToken)
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // Compute the expected hash: HMAC-SHA256(dataCheckString, secretKey)
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  const hashBuffer = Buffer.from(hash, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (
    hashBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(hashBuffer, expectedBuffer)
  ) {
    throw new TelegramAuthError("initData hash validation failed", "INVALID_HASH");
  }

  // Check auth_date freshness
  const authDateStr = params.get("auth_date");
  if (!authDateStr) {
    throw new TelegramAuthError("Missing auth_date in initData", "MISSING_AUTH_DATE");
  }

  const authDate = parseInt(authDateStr, 10);
  const now = Math.floor(Date.now() / 1000);

  if (now - authDate > TELEGRAM_AUTH_DATE_MAX_AGE_SECONDS) {
    throw new TelegramAuthError(
      `initData is stale (auth_date is ${now - authDate}s old)`,
      "STALE_INIT_DATA"
    );
  }

  // Parse user object
  const userStr = params.get("user");
  if (!userStr) {
    throw new TelegramAuthError("Missing user in initData", "MISSING_USER");
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userStr) as TelegramUser;
  } catch {
    throw new TelegramAuthError("Failed to parse user from initData", "INVALID_USER");
  }

  if (!user.id || !user.first_name) {
    throw new TelegramAuthError("User data is incomplete", "INCOMPLETE_USER");
  }

  return {
    user,
    auth_date: authDate,
    hash,
    query_id: params.get("query_id") ?? undefined,
    chat_type: params.get("chat_type") ?? undefined,
  };
}


