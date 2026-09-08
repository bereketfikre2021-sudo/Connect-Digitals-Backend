/**
 * Callback query handlers for all inline keyboard buttons that use
 * callback_data (i.e. non-webApp buttons).
 *
 * Conventions:
 *  - Every handler MUST call ctx.answerCallbackQuery() to acknowledge the
 *    action and dismiss the loading indicator in Telegram clients.
 *  - Handlers that show new content send a new message rather than editing
 *    the original, keeping the conversation readable.
 *  - Errors are caught, logged, and surfaced as a plain user-facing message.
 *    Internal details (stack traces, SQL, env vars) are never exposed.
 */

import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

// ── Helper ────────────────────────────────────────────────────────────────────

async function safeAnswer(ctx: Context, text?: string): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text ? { text, show_alert: false } : {});
  } catch (err) {
    // answerCallbackQuery can fail if the callback is too old (>10 min).
    // Log and continue — never crash the bot because of a stale callback.
    logger.warn({ err }, "Failed to answer callback query (likely expired)");
  }
}

// ── how_it_works ──────────────────────────────────────────────────────────────

export async function handleCallbackHowItWorks(ctx: Context): Promise<void> {
  await safeAnswer(ctx);

  const miniAppUrl = env.MINI_APP_URL;
  const keyboard = new InlineKeyboard();
  if (miniAppUrl) {
    keyboard.webApp("🚀 Start Advertising", miniAppUrl);
  }

  try {
    await ctx.reply(
      `<b>📋 How Connect Digitals Works</b>\n\n` +
      `<b>01 · Choose</b>\n` +
      `Select the content or promotion you want to advertise.\n\n` +
      `<b>02 · Define</b>\n` +
      `Set your audience, budget, duration, and campaign preferences.\n\n` +
      `<b>03 · Fund</b>\n` +
      `Complete your payment or use your available wallet balance.\n\n` +
      `<b>04 · Review</b>\n` +
      `Your campaign is reviewed and prepared for launch.\n\n` +
      `<b>05 · Launch</b>\n` +
      `Once approved, your campaign goes live.\n\n` +
      `<b>06 · Track</b>\n` +
      `Monitor your campaign and stay updated from your dashboard.\n\n` +
      `Ready to get started?`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (err) {
    logger.error({ err }, "Error in handleCallbackHowItWorks");
  }
}

// ── support_menu ──────────────────────────────────────────────────────────────

export async function handleCallbackSupportMenu(ctx: Context): Promise<void> {
  await safeAnswer(ctx);

  const keyboard = new InlineKeyboard()
    .text("📊 Campaign Support", "support_campaign")
    .row()
    .text("💳 Payment Support",  "support_payment")
    .row()
    .text("👤 Account Support",  "support_account")
    .row()
    .text("💬 Contact Support",  "support_contact");

  try {
    await ctx.reply(
      `<b>💬 Connect Digitals Support</b>\n\n` +
      `Need assistance with a campaign, payment, account, or anything else?\n\n` +
      `Our support team is here to help.\n\n` +
      `What do you need help with?`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (err) {
    logger.error({ err }, "Error in handleCallbackSupportMenu");
  }
}

// ── support_campaign ──────────────────────────────────────────────────────────

export async function handleCallbackSupportCampaign(ctx: Context): Promise<void> {
  await safeAnswer(ctx);

  try {
    await ctx.reply(
      `<b>📊 Campaign Support</b>\n\n` +
      `For help with your campaigns — creation, targeting, budget, or approval status — ` +
      `please reach out to our support team:\n\n` +
      `📧 <b>support@connectdigitals.com</b>\n\n` +
      `Include your campaign details so we can assist you faster.`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "Error in handleCallbackSupportCampaign");
  }
}

// ── support_payment ───────────────────────────────────────────────────────────

export async function handleCallbackSupportPayment(ctx: Context): Promise<void> {
  await safeAnswer(ctx);

  try {
    await ctx.reply(
      `<b>💳 Payment Support</b>\n\n` +
      `For help with payments, deposits, or wallet issues:\n\n` +
      `📧 <b>support@connectdigitals.com</b>\n\n` +
      `Please include your payment reference or order number when contacting us.`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "Error in handleCallbackSupportPayment");
  }
}

// ── support_account ───────────────────────────────────────────────────────────

export async function handleCallbackSupportAccount(ctx: Context): Promise<void> {
  await safeAnswer(ctx);

  try {
    await ctx.reply(
      `<b>👤 Account Support</b>\n\n` +
      `For help with your account — access, profile, or security concerns:\n\n` +
      `📧 <b>support@connectdigitals.com</b>\n\n` +
      `Response time: within 24 hours.`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "Error in handleCallbackSupportAccount");
  }
}

// ── support_contact ───────────────────────────────────────────────────────────

export async function handleCallbackSupportContact(ctx: Context): Promise<void> {
  await safeAnswer(ctx);

  try {
    await ctx.reply(
      `<b>💬 Contact Support</b>\n\n` +
      `Our support team is available to help with any question.\n\n` +
      `📧 <b>support@connectdigitals.com</b>\n` +
      `⏰ Response time: within 24 hours\n\n` +
      `Please include as much detail as possible — your order number, ` +
      `campaign name, or account information — so we can assist you quickly.`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    logger.error({ err }, "Error in handleCallbackSupportContact");
  }
}

// ── Fallback for unknown callbacks ────────────────────────────────────────────

export async function handleUnknownCallback(ctx: Context): Promise<void> {
  // Acknowledge silently — do not crash or confuse the user.
  await safeAnswer(ctx);
  logger.warn({ data: ctx.callbackQuery?.data }, "Received unknown callback query data");
}
