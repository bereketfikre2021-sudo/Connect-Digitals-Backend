/**
 * /broadcast command handler and wizard state machine.
 *
 * Only reachable by admins listed in TELEGRAM_ADMIN_IDS.
 * All other users get a silent "Unauthorized" reply with no details.
 *
 * Flow:
 *  /broadcast → Broadcast Center menu
 *    ├─ 📢 New Broadcast → type_select step (TEXT / PHOTO / VIDEO / DOCUMENT)
 *    │    ├─ TEXT   → content_text   → buttons → preview → confirm/cancel
 *    │    └─ media  → content_media_id → content_caption → buttons → preview
 *    ├─ 📋 History  → list recent broadcasts
 *    └─ ❌ Cancel   → delete draft and dismiss
 *
 * Wizard state is persisted in BroadcastDraft (DB) so it survives restarts.
 * Stale drafts expire automatically after DRAFT_TTL_HOURS.
 *
 * Incoming text messages from the admin during an active wizard step are
 * intercepted by handleBroadcastMessage() which bot.ts registers via
 * bot.on("message", …) filtered by isTelegramAdmin().
 */

import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { isTelegramAdmin } from "../lib/admin-auth.js";
import { logger } from "../lib/logger.js";
import {
  loadDraft,
  upsertDraft,
  deleteDraft,
  validateUrl,
  type DraftPayload,
  type DraftStep,
} from "../../services/telegram-broadcast.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminId(ctx: Context): string {
  return String(ctx.from?.id ?? "");
}

async function unauthorized(ctx: Context): Promise<void> {
  await ctx.reply("Unauthorized.").catch(() => null);
}

/** Build the Broadcast Center root menu keyboard. */
function broadcastCenterKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📢 New Broadcast",   "bc_new")
    .row()
    .text("📋 History",          "bc_history")
    .row()
    .text("❌ Cancel",           "bc_cancel");
}

/** Build the message type selector keyboard. */
function messageTypeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Text",     "bc_type_TEXT")
    .text("Photo",    "bc_type_PHOTO")
    .row()
    .text("Video",    "bc_type_VIDEO")
    .text("Document", "bc_type_DOCUMENT")
    .row()
    .text("❌ Cancel", "bc_cancel");
}

/** Build the buttons-step keyboard. */
function buttonsStepKeyboard(hasButtons: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hasButtons) {
    kb.text("➕ Add Another Button", "bc_btn_add").row();
    kb.text("✅ Done — Preview",     "bc_btn_done").row();
  } else {
    kb.text("➕ Add CTA Button",     "bc_btn_add").row();
    kb.text("⏭ No Buttons — Preview","bc_btn_done").row();
  }
  kb.text("❌ Cancel", "bc_cancel");
  return kb;
}

/** Build the preview confirmation keyboard. */
function previewKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Send Broadcast", "bc_confirm_send")
    .row()
    .text("✏️ Edit",           "bc_edit")
    .row()
    .text("❌ Cancel",         "bc_cancel");
}

/**
 * Render a readable preview of the current draft payload.
 * Does NOT actually send to users — only shown to the admin.
 */
export function renderDraftPreview(payload: DraftPayload): string {
  const type = payload.messageType ?? "—";
  const lines: string[] = [`<b>📋 Broadcast Preview</b>\n`, `<b>Type:</b> ${type}\n`];

  if (payload.messageType === "TEXT") {
    lines.push(`<b>Message:</b>\n${escapeHtml(payload.text ?? "(none)")}`);
  } else {
    if (payload.mediaFileId) {
      lines.push(`<b>File ID:</b> <code>${escapeHtml(payload.mediaFileId)}</code>`);
    }
    if (payload.caption) {
      lines.push(`<b>Caption:</b>\n${escapeHtml(payload.caption)}`);
    }
  }

  if (payload.buttons && payload.buttons.length > 0) {
    lines.push(`\n<b>Buttons:</b>`);
    for (const row of payload.buttons) {
      const rowText = row.map(b => `[${escapeHtml(b.text)}](${escapeHtml(b.url)})`).join("  ");
      lines.push(`  ${rowText}`);
    }
  } else {
    lines.push(`\n<b>Buttons:</b> None`);
  }

  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── /broadcast entry point ────────────────────────────────────────────────────

export async function handleBroadcast(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!id || !isTelegramAdmin(id)) {
    await unauthorized(ctx);
    return;
  }

  logger.info({ telegramAdminId: id }, "Admin opened /broadcast");

  await ctx.reply(
    `<b>📡 Broadcast Center</b>\n\nSend a message to all registered users via the bot.`,
    { parse_mode: "HTML", reply_markup: broadcastCenterKeyboard() },
  );
}

// ── Wizard: New Broadcast ─────────────────────────────────────────────────────

export async function handleBroadcastNew(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }

  // Start fresh draft
  await upsertDraft(id, "type_select", {});

  try { await ctx.answerCallbackQuery(); } catch { /* stale */ }
  await ctx.reply(
    `<b>Step 1 — Message Type</b>\n\nWhat type of message do you want to broadcast?`,
    { parse_mode: "HTML", reply_markup: messageTypeKeyboard() },
  );
}

// ── Wizard: Type selected ─────────────────────────────────────────────────────

export async function handleBroadcastTypeSelect(ctx: Context, messageType: string): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }

  const validTypes = ["TEXT", "PHOTO", "VIDEO", "DOCUMENT"] as const;
  if (!validTypes.includes(messageType as never)) {
    try { await ctx.answerCallbackQuery({ text: "Invalid type", show_alert: true }); } catch { /* stale */ }
    return;
  }

  const type = messageType as typeof validTypes[number];
  await upsertDraft(id, type === "TEXT" ? "content_text" : "content_media_id", { messageType: type });

  try { await ctx.answerCallbackQuery(); } catch { /* stale */ }

  if (type === "TEXT") {
    await ctx.reply(
      `<b>Step 2 — Message Content</b>\n\nSend me the text of your broadcast message.\n\n<i>HTML formatting is supported: &lt;b&gt;, &lt;i&gt;, &lt;a href="..."&gt;, etc.</i>`,
      { parse_mode: "HTML" },
    );
  } else {
    await ctx.reply(
      `<b>Step 2 — ${type === "PHOTO" ? "Photo" : type === "VIDEO" ? "Video" : "Document"} File</b>\n\nSend me the ${type.toLowerCase()} message you want to broadcast.\n\nI will reuse the Telegram file_id — no re-uploading needed.`,
      { parse_mode: "HTML" },
    );
  }
}

// ── Wizard: Button text entry step ────────────────────────────────────────────

export async function handleBroadcastButtonAdd(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }

  const draft = await loadDraft(id);
  if (!draft) {
    try { await ctx.answerCallbackQuery({ text: "Session expired. Use /broadcast to start again.", show_alert: true }); } catch { /* stale */ }
    return;
  }

  await upsertDraft(id, "buttons", {
    ...draft.payload,
    pendingButton: {},
  });

  try { await ctx.answerCallbackQuery(); } catch { /* stale */ }
  await ctx.reply(
    `<b>Button Text</b>\n\nSend me the button label text.\n<i>Example: Open App</i>`,
    { parse_mode: "HTML" },
  );
}

// ── Wizard: Buttons done → preview ───────────────────────────────────────────

export async function handleBroadcastButtonsDone(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }

  const draft = await loadDraft(id);
  if (!draft) {
    try { await ctx.answerCallbackQuery({ text: "Session expired. Use /broadcast to start again.", show_alert: true }); } catch { /* stale */ }
    return;
  }

  const payload: DraftPayload = { ...draft.payload, pendingButton: undefined };
  await upsertDraft(id, "preview", payload);

  try { await ctx.answerCallbackQuery(); } catch { /* stale */ }
  await ctx.reply(
    renderDraftPreview(payload) + `\n\n<i>Review carefully — this will be sent to all users.</i>`,
    { parse_mode: "HTML", reply_markup: previewKeyboard() },
  );
}

// ── Wizard: Edit — go back to type select ────────────────────────────────────

export async function handleBroadcastEdit(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }

  await upsertDraft(id, "type_select", {});
  try { await ctx.answerCallbackQuery(); } catch { /* stale */ }
  await ctx.reply(
    `<b>Edit Broadcast</b>\n\nStarting over — choose the message type:`,
    { parse_mode: "HTML", reply_markup: messageTypeKeyboard() },
  );
}

// ── Wizard: Cancel ───────────────────────────────────────────────────────────

export async function handleBroadcastCancel(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) { await unauthorized(ctx); return; }

  await deleteDraft(id);
  try { await ctx.answerCallbackQuery(); } catch { /* stale */ }
  await ctx.reply("Broadcast cancelled. No messages were sent.");
}

// ── Incoming message interceptor ─────────────────────────────────────────────
// Called from bot.ts for every non-command message from a Telegram admin.
// Routes to the correct wizard step based on draft.step.

export async function handleBroadcastMessage(ctx: Context): Promise<void> {
  const id = adminId(ctx);
  if (!isTelegramAdmin(id)) return; // not an admin — ignore

  const draft = await loadDraft(id);
  if (!draft) return; // no active draft — fall through to normal handler

  const { step, payload } = draft;

  switch (step) {

    // ── Admin sends the text content ─────────────────────────────────────────
    case "content_text": {
      const text = ctx.message?.text?.trim();
      if (!text) { await ctx.reply("Please send text content for the broadcast."); return; }
      if (text.length > 4096) {
        await ctx.reply(`Message too long (${text.length} chars). Telegram limit is 4096 characters.`);
        return;
      }
      const updated: DraftPayload = { ...payload, text };
      await upsertDraft(id, "buttons", updated);
      await ctx.reply(
        `<b>Step 3 — CTA Buttons (optional)</b>\n\nAdd interactive buttons to your message?`,
        { parse_mode: "HTML", reply_markup: buttonsStepKeyboard(false) },
      );
      break;
    }

    // ── Admin forwards/sends the media file ──────────────────────────────────
    case "content_media_id": {
      let fileId: string | undefined;

      if (payload.messageType === "PHOTO") {
        const photos = ctx.message?.photo;
        fileId = photos?.[photos.length - 1]?.file_id;
      } else if (payload.messageType === "VIDEO") {
        fileId = ctx.message?.video?.file_id;
      } else if (payload.messageType === "DOCUMENT") {
        fileId = ctx.message?.document?.file_id;
      }

      if (!fileId) {
        const expected = payload.messageType?.toLowerCase() ?? "file";
        await ctx.reply(`Please send a ${expected} message. I need to capture the file_id.`);
        return;
      }

      const updated: DraftPayload = { ...payload, mediaFileId: fileId };
      await upsertDraft(id, "content_caption", updated);
      await ctx.reply(
        `<b>File received.</b> File ID captured.\n\nNow send the caption for this ${payload.messageType?.toLowerCase()}, or type <code>skip</code> to omit the caption.`,
        { parse_mode: "HTML" },
      );
      break;
    }

    // ── Admin sends caption (or "skip") ──────────────────────────────────────
    case "content_caption": {
      const text = ctx.message?.text?.trim();
      const caption = text?.toLowerCase() === "skip" ? undefined : text;
      if (caption && caption.length > 1024) {
        await ctx.reply(`Caption too long (${caption.length} chars). Telegram limit is 1024 characters.`);
        return;
      }
      const updated: DraftPayload = { ...payload, caption };
      await upsertDraft(id, "buttons", updated);
      await ctx.reply(
        `<b>Step 3 — CTA Buttons (optional)</b>\n\nAdd interactive buttons to your message?`,
        { parse_mode: "HTML", reply_markup: buttonsStepKeyboard(false) },
      );
      break;
    }

    // ── Admin is adding a button — first message = button text ───────────────
    case "buttons": {
      if (!payload.pendingButton) {
        // Shouldn't happen, but guard anyway
        await ctx.reply("Unexpected state. Use /broadcast to start again.");
        await deleteDraft(id);
        return;
      }

      if (payload.pendingButton.text === undefined) {
        // Expecting button text
        const btnText = ctx.message?.text?.trim();
        if (!btnText) { await ctx.reply("Button text cannot be empty."); return; }

        const updated: DraftPayload = {
          ...payload,
          pendingButton: { text: btnText },
        };
        await upsertDraft(id, "buttons", updated);
        await ctx.reply(
          `<b>Button URL</b>\n\nNow send the URL for the "<b>${escapeHtml(btnText)}</b>" button.\n<i>Must start with https://</i>`,
          { parse_mode: "HTML" },
        );
      } else {
        // Expecting button URL
        const btnUrl = ctx.message?.text?.trim();
        if (!btnUrl) { await ctx.reply("Button URL cannot be empty."); return; }

        try {
          validateUrl(btnUrl);
        } catch (err) {
          await ctx.reply(`Invalid URL: ${err instanceof Error ? err.message : String(err)}\n\nPlease send a valid URL.`);
          return;
        }

        // Add the completed button as a new row
        const existingButtons: [[{text: string; url: string}]] = (payload.buttons as never) ?? [];
        const newButton = { text: payload.pendingButton.text, url: btnUrl };
        const updatedButtons = [...existingButtons, [newButton]];

        const updated: DraftPayload = {
          ...payload,
          buttons:       updatedButtons,
          pendingButton: undefined,
        };
        await upsertDraft(id, "buttons", updated);
        await ctx.reply(
          `Button "<b>${escapeHtml(newButton.text)}</b>" added.\n\nAdd another button or finish?`,
          { parse_mode: "HTML", reply_markup: buttonsStepKeyboard(true) },
        );
      }
      break;
    }

    // ── No active wizard step — ignore ────────────────────────────────────────
    default:
      break;
  }
}

// Re-export helpers needed by callbacks
export { buttonsStepKeyboard, broadcastCenterKeyboard, previewKeyboard, escapeHtml };
