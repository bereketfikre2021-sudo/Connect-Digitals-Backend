/**
 * Telegram Broadcast Service
 *
 * Responsible for:
 *  - Resolving broadcast audience (Telegram user IDs from TelegramIdentity)
 *  - Sending messages in a rate-limited, sequential manner
 *  - Handling Telegram API errors (429 retry_after, 403 blocked, etc.)
 *  - Tracking per-recipient delivery in BroadcastDelivery
 *  - Updating Broadcast counters atomically
 *  - Idempotency guard — prevents executing the same broadcast twice
 *
 * IMPORTANT: this service imports the bot singleton from bot/bot.ts to avoid
 * creating a second Bot instance (which would duplicate the connection).
 *
 * Rate-limit strategy:
 *  Telegram allows roughly 30 messages/second globally, and 1 message/second
 *  per chat. We use a conservative sequential approach with a 50 ms inter-message
 *  delay (≈ 20 msg/s) and honour 429 retry_after responses.
 */

import { Bot, GrammyError, InlineKeyboard } from "grammy";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type {
  BroadcastMessageType,
  BroadcastAudienceType,
} from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single CTA button. */
export interface BroadcastButton {
  text: string;
  url:  string;
}

/** One row of CTA buttons. */
export type BroadcastButtonRow = BroadcastButton[];

/** The full buttons grid — array of rows. */
export type BroadcastButtons = BroadcastButtonRow[];

/** Input used to create a new broadcast. */
export interface CreateBroadcastInput {
  createdBy:    string;          // Telegram admin numeric user ID (as string)
  messageType:  BroadcastMessageType;
  text?:        string;          // For TEXT messages
  caption?:     string;          // For PHOTO/VIDEO/DOCUMENT messages
  mediaFileId?: string;          // Telegram file_id to reuse
  buttons?:     BroadcastButtons;
  audienceType: BroadcastAudienceType;
}

/** Result returned after a broadcast completes (or fails). */
export interface BroadcastResult {
  broadcastId:     string;
  totalRecipients: number;
  sentCount:       number;
  failedCount:     number;
  blockedCount:    number;
  status:          string;
}

/** A row returned from the audience query — minimal fields needed for sending. */
interface AudienceRow {
  telegramUserId: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Delay between each message send to stay within Telegram rate limits (ms). */
const INTER_MESSAGE_DELAY_MS = 50;

/** Max message text length Telegram allows. */
const MAX_TEXT_LENGTH = 4096;

/** Max caption length Telegram allows. */
const MAX_CAPTION_LENGTH = 1024;

/** Draft TTL — how long an admin's in-progress wizard draft survives. */
export const DRAFT_TTL_HOURS = 2;

// ── Lazy bot accessor ─────────────────────────────────────────────────────────
// We import the singleton lazily to avoid a circular dependency at module load
// time between bot.ts and this service.

let _botInstance: Bot | null = null;

export function setBotInstance(bot: Bot): void {
  _botInstance = bot;
}

function getBot(): Bot {
  if (_botInstance) return _botInstance;
  // Fallback: construct from token. This path is only hit if setBotInstance()
  // was never called (e.g. standalone tests or unusual startup order).
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN not set — cannot send broadcast");
  }
  _botInstance = new Bot(env.TELEGRAM_BOT_TOKEN);
  return _botInstance;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateBroadcastInput(input: CreateBroadcastInput): void {
  const { messageType, text, caption, mediaFileId, buttons } = input;

  switch (messageType) {
    case "TEXT":
      if (!text || text.trim().length === 0) {
        throw new Error("Text message requires non-empty text content");
      }
      if (text.length > MAX_TEXT_LENGTH) {
        throw new Error(`Text exceeds Telegram limit of ${MAX_TEXT_LENGTH} characters (current: ${text.length})`);
      }
      break;

    case "PHOTO":
    case "VIDEO":
    case "DOCUMENT":
      if (!mediaFileId || mediaFileId.trim().length === 0) {
        throw new Error(`${messageType} message requires a Telegram file_id`);
      }
      if (caption && caption.length > MAX_CAPTION_LENGTH) {
        throw new Error(`Caption exceeds Telegram limit of ${MAX_CAPTION_LENGTH} characters (current: ${caption.length})`);
      }
      break;
  }

  if (buttons) {
    validateButtons(buttons);
  }
}

export function validateButtons(buttons: BroadcastButtons): void {
  if (!Array.isArray(buttons)) throw new Error("Buttons must be an array of rows");
  for (const row of buttons) {
    if (!Array.isArray(row)) throw new Error("Each button row must be an array");
    for (const btn of row) {
      if (!btn.text || btn.text.trim().length === 0) {
        throw new Error("Button text cannot be empty");
      }
      if (!btn.url || btn.url.trim().length === 0) {
        throw new Error("Button URL cannot be empty");
      }
      validateUrl(btn.url);
    }
  }
}

export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`URL must use http or https scheme: "${url}"`);
  }
}

// ── Audience resolution ───────────────────────────────────────────────────────

async function resolveAudience(
  audienceType: BroadcastAudienceType,
): Promise<AudienceRow[]> {
  switch (audienceType) {
    case "ALL_USERS":
      return prisma.telegramIdentity.findMany({
        select: { telegramUserId: true },
      });

    default: {
      const _: never = audienceType;
      throw new Error(`Unknown audience type: ${String(_)}`);
    }
  }
}

// ── Inline keyboard builder ───────────────────────────────────────────────────

function buildInlineKeyboard(buttons: BroadcastButtons): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (let rowIdx = 0; rowIdx < buttons.length; rowIdx++) {
    const row = buttons[rowIdx];
    if (!row) continue;

    // Add a row separator before each row except the first
    if (rowIdx > 0) kb.row();

    for (const btn of row) {
      if (!btn?.text || !btn?.url) continue;
      kb.url(btn.text.trim(), btn.url.trim());
    }
  }

  return kb;
}

// ── Rate-limited sleep ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Core send function for a single recipient ─────────────────────────────────

type SendOutcome =
  | { status: "sent"; messageId: number }
  | { status: "blocked"; errorCode: string; errorMessage: string }
  | { status: "failed"; errorCode: string; errorMessage: string }
  | { status: "rate_limited"; retryAfter: number };

async function sendToRecipient(
  bot:     Bot,
  chatId:  string,
  input:   CreateBroadcastInput,
): Promise<SendOutcome> {
  // Only build keyboard if buttons array has at least one valid button
  const hasButtons = input.buttons && input.buttons.length > 0 &&
    input.buttons.some(row => row.some(btn => btn?.text && btn?.url));

  const kb = hasButtons ? buildInlineKeyboard(input.buttons!) : undefined;
  const parseMode = "HTML" as const;

  try {
    let messageId: number;

    switch (input.messageType) {
      case "TEXT": {
        const msg = await bot.api.sendMessage(chatId, input.text ?? "", {
          parse_mode: parseMode,
          reply_markup: kb,
        });
        messageId = msg.message_id;
        break;
      }

      case "PHOTO": {
        const msg = await bot.api.sendPhoto(chatId, input.mediaFileId ?? "", {
          caption: input.caption,
          parse_mode: parseMode,
          reply_markup: kb,
        });
        messageId = msg.message_id;
        break;
      }

      case "VIDEO": {
        const msg = await bot.api.sendVideo(chatId, input.mediaFileId ?? "", {
          caption: input.caption,
          parse_mode: parseMode,
          reply_markup: kb,
        });
        messageId = msg.message_id;
        break;
      }

      case "DOCUMENT": {
        const msg = await bot.api.sendDocument(chatId, input.mediaFileId ?? "", {
          caption: input.caption,
          parse_mode: parseMode,
          reply_markup: kb,
        });
        messageId = msg.message_id;
        break;
      }

      default: {
        const _: never = input.messageType;
        throw new Error(`Unknown message type: ${String(_)}`);
      }
    }

    return { status: "sent", messageId };

  } catch (err) {
    if (err instanceof GrammyError) {
      const code    = String(err.error_code);
      const message = err.description;

      // 429 — rate limited; Telegram tells us how long to wait
      if (err.error_code === 429) {
        const retryAfter = (err.parameters as { retry_after?: number })?.retry_after ?? 5;
        return { status: "rate_limited", retryAfter };
      }

      // 403 — bot was blocked or chat unavailable
      if (err.error_code === 403) {
        return { status: "blocked", errorCode: code, errorMessage: message };
      }

      // 400 with "chat not found" is also effectively blocked/invalid
      if (err.error_code === 400 && message.toLowerCase().includes("chat not found")) {
        return { status: "blocked", errorCode: code, errorMessage: message };
      }

      return { status: "failed", errorCode: code, errorMessage: message };
    }

    // Network or unexpected error
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", errorCode: "UNKNOWN", errorMessage: msg };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates a Broadcast record in DRAFT state.
 * Returns the broadcastId which the caller uses to confirm and execute.
 */
export async function createBroadcast(input: CreateBroadcastInput): Promise<string> {
  validateBroadcastInput(input);

  const broadcast = await prisma.broadcast.create({
    data: {
      createdBy:   input.createdBy,
      messageType: input.messageType,
      text:        input.text        ?? null,
      caption:     input.caption     ?? null,
      mediaFileId: input.mediaFileId ?? null,
      buttons:     (input.buttons ?? null) as never,
      audienceType: input.audienceType,
      status:      "DRAFT",
    },
  });

  logger.info({ broadcastId: broadcast.id, createdBy: input.createdBy, messageType: input.messageType }, "Broadcast created");
  return broadcast.id;
}

/**
 * Executes a broadcast identified by broadcastId.
 *
 * Idempotency: if the broadcast is already SENDING or COMPLETED, this is a
 * no-op and returns the current counters without resending.
 *
 * This function is designed to be called once — after the admin confirms the
 * preview. It will run to completion before returning.
 */
export async function executeBroadcast(broadcastId: string): Promise<BroadcastResult> {
  // ── Load and lock ──────────────────────────────────────────────────────────
  const broadcast = await prisma.broadcast.findUnique({
    where: { id: broadcastId },
  });

  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  // Idempotency guard — do not re-execute
  if (broadcast.status === "SENDING" || broadcast.status === "COMPLETED") {
    logger.warn({ broadcastId, status: broadcast.status }, "Broadcast already executed — skipping");
    return {
      broadcastId,
      totalRecipients: broadcast.totalRecipients,
      sentCount:       broadcast.sentCount,
      failedCount:     broadcast.failedCount,
      blockedCount:    broadcast.blockedCount,
      status:          broadcast.status,
    };
  }

  if (broadcast.status === "CANCELLED") {
    throw new Error(`Broadcast ${broadcastId} was cancelled`);
  }

  // ── Resolve audience ───────────────────────────────────────────────────────
  const audience = await resolveAudience(broadcast.audienceType);
  const totalRecipients = audience.length;

  logger.info({ broadcastId, totalRecipients, audienceType: broadcast.audienceType }, "Broadcast started");

  // ── Mark as SENDING ────────────────────────────────────────────────────────
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data:  { status: "SENDING", startedAt: new Date(), totalRecipients },
  });

  // ── Create delivery records in bulk (PENDING) ──────────────────────────────
  // Use skipDuplicates for idempotency in case of partial restart
  await prisma.broadcastDelivery.createMany({
    data: audience.map(r => ({
      broadcastId,
      telegramUserId: r.telegramUserId,
      status:         "PENDING" as const,
    })),
    skipDuplicates: true,
  });

  // ── Send ───────────────────────────────────────────────────────────────────
  const bot = getBot();
  let sentCount    = 0;
  let failedCount  = 0;
  let blockedCount = 0;

  const input: CreateBroadcastInput = {
    createdBy:    broadcast.createdBy,
    messageType:  broadcast.messageType,
    text:         broadcast.text        ?? undefined,
    caption:      broadcast.caption     ?? undefined,
    mediaFileId:  broadcast.mediaFileId ?? undefined,
    buttons:      broadcast.buttons     ? (broadcast.buttons as unknown as BroadcastButtons) : undefined,
    audienceType: broadcast.audienceType,
  };

  for (const recipient of audience) {
    const chatId = recipient.telegramUserId;
    let outcome = await sendToRecipient(bot, chatId, input);

    // Handle rate limiting with retry
    if (outcome.status === "rate_limited") {
      const waitMs = (outcome.retryAfter + 1) * 1000;
      logger.warn({ broadcastId, chatId, retryAfter: outcome.retryAfter }, "Rate limited — waiting");
      await sleep(waitMs);
      // Retry once after the wait
      outcome = await sendToRecipient(bot, chatId, input);
    }

    // Record delivery outcome
    try {
      await prisma.broadcastDelivery.update({
        where: {
          broadcastId_telegramUserId: { broadcastId, telegramUserId: chatId },
        },
        data: outcome.status === "sent"
          ? { status: "SENT", telegramMessageId: outcome.messageId, sentAt: new Date() }
          : outcome.status === "blocked"
            ? { status: "BLOCKED", errorCode: outcome.errorCode, errorMessage: outcome.errorMessage }
            : outcome.status === "rate_limited"
              // Still rate limited after retry — treat as failed
              ? { status: "FAILED", errorCode: "429", errorMessage: "Rate limited after retry" }
              : { status: "FAILED", errorCode: outcome.errorCode, errorMessage: outcome.errorMessage },
      });
    } catch (dbErr) {
      logger.warn({ dbErr, broadcastId, chatId }, "Failed to update delivery record");
    }

    if (outcome.status === "sent") {
      sentCount++;
    } else if (outcome.status === "blocked") {
      blockedCount++;
      logger.info({ broadcastId, chatId }, "Recipient blocked bot");
    } else {
      failedCount++;
      logger.warn({ broadcastId, chatId, outcome }, "Delivery failed");
    }

    // Inter-message delay to stay within Telegram rate limits
    await sleep(INTER_MESSAGE_DELAY_MS);
  }

  // ── Mark as COMPLETED ──────────────────────────────────────────────────────
  const finalStatus = failedCount > 0 && sentCount === 0 ? "FAILED" : "COMPLETED";

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status:      finalStatus,
      completedAt: new Date(),
      sentCount,
      failedCount,
      blockedCount,
    },
  });

  logger.info({ broadcastId, totalRecipients, sentCount, failedCount, blockedCount, finalStatus }, "Broadcast completed");

  return { broadcastId, totalRecipients, sentCount, failedCount, blockedCount, status: finalStatus };
}

/**
 * Cancels a DRAFT broadcast. Cannot cancel one that is already SENDING.
 */
export async function cancelBroadcast(broadcastId: string): Promise<void> {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!broadcast) return;
  if (broadcast.status === "SENDING") {
    throw new Error("Cannot cancel a broadcast that is currently sending");
  }
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data:  { status: "CANCELLED" },
  });
  logger.info({ broadcastId }, "Broadcast cancelled");
}

// ── Draft (wizard state) helpers ──────────────────────────────────────────────

export type DraftStep =
  | "type_select"
  | "content_text"
  | "content_media_id"
  | "content_caption"
  | "buttons"
  | "preview";

export interface DraftPayload {
  messageType?: BroadcastMessageType;
  text?:        string;
  caption?:     string;
  mediaFileId?: string;
  buttons?:     BroadcastButtons;
  // Temporary accumulator while admin adds buttons one by one
  pendingButton?: { text?: string };
}

/**
 * Upsert a wizard draft for the given admin.
 * A new draft is created (or the existing one replaced) with a fresh TTL.
 */
export async function upsertDraft(
  telegramAdminId: string,
  step:            DraftStep,
  payload:         DraftPayload,
): Promise<void> {
  const expiresAt = new Date(Date.now() + DRAFT_TTL_HOURS * 60 * 60 * 1000);
  await prisma.broadcastDraft.upsert({
    where:  { telegramAdminId },
    create: { telegramAdminId, step, payload: payload as never, expiresAt },
    update: { step, payload: payload as never, expiresAt },
  });
}

/**
 * Load a draft for the given admin. Returns null if expired or not found.
 */
export async function loadDraft(
  telegramAdminId: string,
): Promise<{ step: DraftStep; payload: DraftPayload } | null> {
  const draft = await prisma.broadcastDraft.findUnique({
    where: { telegramAdminId },
  });
  if (!draft) return null;
  if (draft.expiresAt < new Date()) {
    // Expired — clean up silently
    await prisma.broadcastDraft.delete({ where: { telegramAdminId } }).catch(() => null);
    return null;
  }
  return {
    step:    draft.step as DraftStep,
    payload: draft.payload as DraftPayload,
  };
}

/**
 * Delete the draft for the given admin (cancel or after confirmation).
 */
export async function deleteDraft(telegramAdminId: string): Promise<void> {
  await prisma.broadcastDraft.delete({ where: { telegramAdminId } }).catch(() => null);
}

// ── Broadcast history ─────────────────────────────────────────────────────────

export interface BroadcastSummary {
  id:              string;
  messageType:     string;
  status:          string;
  totalRecipients: number;
  sentCount:       number;
  failedCount:     number;
  blockedCount:    number;
  createdAt:       Date;
}

/**
 * Returns the most recent broadcasts for history display.
 */
export async function getBroadcastHistory(limit = 10): Promise<BroadcastSummary[]> {
  return prisma.broadcast.findMany({
    orderBy: { createdAt: "desc" },
    take:    limit,
    select: {
      id:              true,
      messageType:     true,
      status:          true,
      totalRecipients: true,
      sentCount:       true,
      failedCount:     true,
      blockedCount:    true,
      createdAt:       true,
    },
  });
}

/**
 * Returns a single broadcast's full detail.
 */
export async function getBroadcastDetail(broadcastId: string) {
  return prisma.broadcast.findUnique({
    where: { id: broadcastId },
    select: {
      id:              true,
      messageType:     true,
      status:          true,
      audienceType:    true,
      totalRecipients: true,
      sentCount:       true,
      failedCount:     true,
      blockedCount:    true,
      createdAt:       true,
      startedAt:       true,
      completedAt:     true,
    },
  });
}

// ── Media upload helper ───────────────────────────────────────────────────────

export type UploadableMessageType = "PHOTO" | "VIDEO" | "DOCUMENT";

/**
 * Upload a media file to Telegram and return the file_id.
 *
 * Strategy:
 *  1. Send the file to the admin's own Telegram chat using the bot API.
 *     Telegram assigns a file_id to the uploaded file server-side.
 *  2. Capture the file_id from the sent message.
 *  3. Immediately delete the staging message so the admin's chat stays clean.
 *  4. Return the file_id — reusable for any number of broadcast sends.
 *
 * @param buffer       Raw file bytes (from multer memory storage)
 * @param mimeType     MIME type of the file
 * @param filename     Original filename (used for documents)
 * @param messageType  PHOTO | VIDEO | DOCUMENT
 * @param adminChatId  Telegram numeric user ID of the uploading admin
 */
export async function uploadMediaForBroadcast(
  buffer:      Buffer,
  mimeType:    string,
  filename:    string,
  messageType: UploadableMessageType,
  adminChatId: string,
): Promise<string> {
  const bot = getBot();

  // grammY accepts a Buffer wrapped in InputFile
  const { InputFile } = await import("grammy");
  const inputFile = new InputFile(buffer, filename);

  let fileId: string;
  let messageId: number;

  try {
    switch (messageType) {
      case "PHOTO": {
        const msg = await bot.api.sendPhoto(adminChatId, inputFile);
        const photos = msg.photo;
        const largest = photos[photos.length - 1];
        if (!largest) throw new Error("Telegram returned no photo sizes");
        fileId    = largest.file_id;
        messageId = msg.message_id;
        break;
      }
      case "VIDEO": {
        const msg = await bot.api.sendVideo(adminChatId, inputFile);
        fileId    = msg.video.file_id;
        messageId = msg.message_id;
        break;
      }
      case "DOCUMENT": {
        const msg = await bot.api.sendDocument(adminChatId, inputFile);
        fileId    = msg.document.file_id;
        messageId = msg.message_id;
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to upload file to Telegram: ${msg}`);
  }

  // Delete the staging message immediately — keeps the admin's chat clean
  try {
    await bot.api.deleteMessage(adminChatId, messageId);
  } catch {
    // Non-fatal — the file_id is already captured
    logger.warn({ adminChatId, messageId }, "Could not delete staging upload message");
  }

  logger.info({ adminChatId, messageType, fileId }, "Media uploaded to Telegram — file_id captured");
  return fileId;
}
