/**
 * Broadcast callback query handlers.
 *
 * All handlers enforce isTelegramAdmin() on every call — no callback data
 * value can bypass authorization even if a non-admin triggers the callback.
 *
 * Callback data prefixes used:
 *   bc_new              — start new broadcast wizard
 *   bc_history          — show broadcast history
 *   bc_history_<id>     — show single broadcast detail
 *   bc_cancel           — cancel / delete draft
 *   bc_type_<TYPE>      — select message type (TEXT|PHOTO|VIDEO|DOCUMENT)
 *   bc_btn_add          — start adding a CTA button
 *   bc_btn_done         — finish buttons, show preview
 *   bc_edit             — go back to type select
 *   bc_confirm_send     — confirmed: execute the broadcast
 */

import type { Context } from "grammy";
import { isTelegramAdmin } from "../lib/admin-auth.js";
import { logger } from "../lib/logger.js";
import {
  createBroadcast,
  executeBroadcast,
  loadDraft,
  deleteDraft,
  getBroadcastHistory,
  getBroadcastDetail,
  type BroadcastButtons,
} from "../../services/telegram-broadcast.service.js";
import {
  handleBroadcastNew,
  handleBroadcastTypeSelect,
  handleBroadcastButtonAdd,
  handleBroadcastButtonsDone,
  handleBroadcastEdit,
  handleBroadcastCancel,
  broadcastCenterKeyboard,
  renderDraftPreview,
} from "./broadcast.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminId(ctx: Context): string {
  return String(ctx.from?.id ?? "");
}

async function safeAnswer(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text ? { text, show_alert: false } : {});
  } catch { /* expired */ }
}

async function unauthorized(ctx: Context): Promise<void> {
  await safeAnswer(ctx, "Unauthorized.");
}

// ── bc_new ────────────────────────────────────────────────────────────────────

export async function handleCbBroadcastNew(ctx: Context): Promise<void> {
  if (!isTelegramAdmin(adminId(ctx))) { await unauthorized(ctx); return; }
  await handleBroadcastNew(ctx);
}

// ── bc_history ────────────────────────────────────────────────────────────────

export async function handleCbBroadcastHistory(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }
  await safeAnswer(ctx);

  try {
    const history = await getBroadcastHistory(8);

    if (history.length === 0) {
      await ctx.reply("No broadcasts have been sent yet.", { reply_markup: broadcastCenterKeyboard() });
      return;
    }

    const lines = history.map((b, i) => {
      const date = b.createdAt.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
      const statusEmoji: Record<string, string> = {
        COMPLETED: "✅", SENDING: "⏳", FAILED: "❌", CANCELLED: "🚫", DRAFT: "📝",
      };
      const emoji = statusEmoji[b.status] ?? "—";
      return (
        `${i + 1}. ${emoji} <b>${b.messageType}</b> · ${date}\n` +
        `   Recipients: ${b.totalRecipients} · Sent: ${b.sentCount} · ` +
        `Failed: ${b.failedCount} · Blocked: ${b.blockedCount}\n` +
        `   ID: <code>${b.id}</code>`
      );
    });

    await ctx.reply(
      `<b>📋 Broadcast History</b>\n\n${lines.join("\n\n")}`,
      { parse_mode: "HTML", reply_markup: broadcastCenterKeyboard() },
    );
  } catch (err) {
    logger.error({ err, adminId: id }, "Failed to load broadcast history");
    await ctx.reply("Failed to load history. Please try again.");
  }
}

// ── bc_history_<id> ───────────────────────────────────────────────────────────

export async function handleCbBroadcastHistoryDetail(ctx: Context, broadcastId: string): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }
  await safeAnswer(ctx);

  try {
    const detail = await getBroadcastDetail(broadcastId);
    if (!detail) {
      await ctx.reply("Broadcast not found.");
      return;
    }
    const date = detail.createdAt.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
    const started = detail.startedAt
      ? detail.startedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : "—";
    const completed = detail.completedAt
      ? detail.completedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
      : "—";

    await ctx.reply(
      `<b>Broadcast Detail</b>\n\n` +
      `<b>ID:</b> <code>${detail.id}</code>\n` +
      `<b>Status:</b> ${detail.status}\n` +
      `<b>Type:</b> ${detail.messageType}\n` +
      `<b>Audience:</b> ${detail.audienceType}\n` +
      `<b>Created:</b> ${date}\n` +
      `<b>Started:</b> ${started}\n` +
      `<b>Completed:</b> ${completed}\n\n` +
      `<b>Recipients:</b> ${detail.totalRecipients}\n` +
      `<b>Sent:</b> ${detail.sentCount}\n` +
      `<b>Failed:</b> ${detail.failedCount}\n` +
      `<b>Blocked:</b> ${detail.blockedCount}`,
      { parse_mode: "HTML" },
    );
  } catch (err) {
    logger.error({ err, adminId: id, broadcastId }, "Failed to load broadcast detail");
    await ctx.reply("Failed to load broadcast detail.");
  }
}

// ── bc_cancel ─────────────────────────────────────────────────────────────────

export async function handleCbBroadcastCancel(ctx: Context): Promise<void> {
  if (!isTelegramAdmin(adminId(ctx))) { await unauthorized(ctx); return; }
  await handleBroadcastCancel(ctx);
}

// ── bc_type_<TYPE> ────────────────────────────────────────────────────────────

export async function handleCbBroadcastType(ctx: Context, messageType: string): Promise<void> {
  if (!isTelegramAdmin(adminId(ctx))) { await unauthorized(ctx); return; }
  await handleBroadcastTypeSelect(ctx, messageType);
}

// ── bc_btn_add ────────────────────────────────────────────────────────────────

export async function handleCbBroadcastButtonAdd(ctx: Context): Promise<void> {
  if (!isTelegramAdmin(adminId(ctx))) { await unauthorized(ctx); return; }
  await handleBroadcastButtonAdd(ctx);
}

// ── bc_btn_done ───────────────────────────────────────────────────────────────

export async function handleCbBroadcastButtonsDone(ctx: Context): Promise<void> {
  if (!isTelegramAdmin(adminId(ctx))) { await unauthorized(ctx); return; }
  await handleBroadcastButtonsDone(ctx);
}

// ── bc_edit ───────────────────────────────────────────────────────────────────

export async function handleCbBroadcastEdit(ctx: Context): Promise<void> {
  if (!isTelegramAdmin(adminId(ctx))) { await unauthorized(ctx); return; }
  await handleBroadcastEdit(ctx);
}

// ── bc_confirm_send ───────────────────────────────────────────────────────────

export async function handleCbBroadcastConfirmSend(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }

  await safeAnswer(ctx);

  // Load draft
  const draft = await loadDraft(id);
  if (!draft || draft.step !== "preview") {
    await ctx.reply("No confirmed broadcast draft found. Use /broadcast to start again.");
    return;
  }

  const { payload } = draft;

  // Final validation before executing
  if (!payload.messageType) {
    await ctx.reply("Draft is incomplete — message type missing. Use /broadcast to start again.");
    return;
  }

  if (payload.messageType === "TEXT" && !payload.text) {
    await ctx.reply("Draft is incomplete — text content missing. Use /broadcast to start again.");
    return;
  }

  if (payload.messageType !== "TEXT" && !payload.mediaFileId) {
    await ctx.reply("Draft is incomplete — file ID missing. Use /broadcast to start again.");
    return;
  }

  try {
    // Create the Broadcast record
    const broadcastId = await createBroadcast({
      createdBy:    id,
      messageType:  payload.messageType,
      text:         payload.text,
      caption:      payload.caption,
      mediaFileId:  payload.mediaFileId,
      buttons:      payload.buttons as BroadcastButtons | undefined,
      audienceType: "ALL_USERS",
    });

    // Delete the draft before executing (idempotency — draft is consumed)
    await deleteDraft(id);

    // Notify admin that sending has begun
    await ctx.reply(
      `<b>⏳ Broadcasting…</b>\n\nYour message is being sent to all users. This may take a few minutes.\nBroadcast ID: <code>${broadcastId}</code>`,
      { parse_mode: "HTML" },
    );

    logger.info({ broadcastId, adminId: id }, "Admin confirmed broadcast — executing");

    // Execute (runs to completion — may take a while for large audiences)
    const result = await executeBroadcast(broadcastId);

    await ctx.reply(
      `<b>✅ Broadcast Complete</b>\n\n` +
      `<b>Recipients:</b> ${result.totalRecipients}\n` +
      `<b>Sent:</b> ${result.sentCount}\n` +
      `<b>Failed:</b> ${result.failedCount}\n` +
      `<b>Blocked:</b> ${result.blockedCount}`,
      { parse_mode: "HTML" },
    );

  } catch (err) {
    logger.error({ err, adminId: id }, "Broadcast execution failed");
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`<b>❌ Broadcast failed</b>\n\n<code>${msg}</code>`, { parse_mode: "HTML" });
  }
}

// ── Dispatcher — routes all bc_* callbacks ────────────────────────────────────
// Registered in bot.ts as a single regex callback handler.

export async function handleBroadcastCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";

  if (data === "bc_new")          return handleCbBroadcastNew(ctx);
  if (data === "bc_history")      return handleCbBroadcastHistory(ctx);
  if (data === "bc_cancel")       return handleCbBroadcastCancel(ctx);
  if (data === "bc_btn_add")      return handleCbBroadcastButtonAdd(ctx);
  if (data === "bc_btn_done")     return handleCbBroadcastButtonsDone(ctx);
  if (data === "bc_edit")         return handleCbBroadcastEdit(ctx);
  if (data === "bc_confirm_send") return handleCbBroadcastConfirmSend(ctx);

  if (data.startsWith("bc_type_")) {
    const msgType = data.replace("bc_type_", "");
    return handleCbBroadcastType(ctx, msgType);
  }

  if (data.startsWith("bc_history_")) {
    const broadcastId = data.replace("bc_history_", "");
    return handleCbBroadcastHistoryDetail(ctx, broadcastId);
  }

  // Unknown bc_ callback — acknowledge silently
  try { await ctx.answerCallbackQuery(); } catch { /* stale */ }
}
