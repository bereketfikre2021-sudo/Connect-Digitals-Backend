/**
 * Bot module — exports the grammY Bot instance and an initBot() function.
 *
 * In production the bot is integrated directly into the Express API server
 * (see src/app.ts) via a /bot/webhook route so both API and bot run in the
 * same Render web service without needing a second port or process.
 *
 * In development, initBot() falls back to long-polling automatically.
 */

import { Bot, BotError, GrammyError, HttpError } from "grammy";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { handleStart }       from "./commands/start.js";
import { handleApp }         from "./commands/app.js";
import { handleCampaigns }   from "./commands/campaigns.js";
import { handleWallet }      from "./commands/wallet.js";
import { handleHowItWorks }  from "./commands/how_it_works.js";
import { handleSupport }     from "./commands/support.js";
import { handleHelp }        from "./commands/help.js";
import { handleOrders }      from "./commands/orders.js";
import { handleProfile }     from "./commands/profile.js";
import { handleServices }    from "./commands/services.js";
import {
  handleCallbackHowItWorks,
  handleCallbackSupportMenu,
  handleCallbackSupportCampaign,
  handleCallbackSupportPayment,
  handleCallbackSupportAccount,
  handleCallbackSupportContact,
  handleUnknownCallback,
} from "./commands/callbacks.js";

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// ── Commands ──────────────────────────────────────────────────────────────────
bot.command("start",        handleStart);
bot.command("app",          handleApp);
bot.command("campaigns",    handleCampaigns);
bot.command("wallet",       handleWallet);
bot.command("how_it_works", handleHowItWorks);
bot.command("support",      handleSupport);
bot.command("help",         handleHelp);
bot.command("orders",       handleOrders);
bot.command("profile",      handleProfile);
bot.command("services",     handleServices);

// ── Callbacks ─────────────────────────────────────────────────────────────────
bot.callbackQuery("how_it_works",     handleCallbackHowItWorks);
bot.callbackQuery("support_menu",     handleCallbackSupportMenu);
bot.callbackQuery("support_campaign", handleCallbackSupportCampaign);
bot.callbackQuery("support_payment",  handleCallbackSupportPayment);
bot.callbackQuery("support_account",  handleCallbackSupportAccount);
bot.callbackQuery("support_contact",  handleCallbackSupportContact);
bot.on("callback_query:data",         handleUnknownCallback);

// ── Fallback ──────────────────────────────────────────────────────────────────
bot.on("message", async (ctx) => {
  await ctx.reply(
    "I didn't understand that. Use /help to see available commands, or /start to open the app."
  );
});

// ── Error handling ────────────────────────────────────────────────────────────
bot.catch((err: BotError) => {
  const ctx = err.ctx;
  logger.error({ updateId: ctx.update.update_id }, "Error handling Telegram update");
  if (err.error instanceof GrammyError)  logger.error({ description: err.error.description }, "grammY error");
  else if (err.error instanceof HttpError) logger.error({ message: err.error.message }, "HTTP error");
  else logger.error(err.error, "Unknown bot error");
});

// ── setMyCommands ─────────────────────────────────────────────────────────────
const COMMANDS = [
  { command: "start",        description: "🚀 Start your advertising journey" },
  { command: "app",          description: "📱 Open Connect Digitals" },
  { command: "campaigns",    description: "📊 View your campaigns" },
  { command: "wallet",       description: "💳 View your balance & payments" },
  { command: "how_it_works", description: "📋 Learn how it works" },
  { command: "support",      description: "💬 Get customer support" },
  { command: "help",         description: "❓ Get help" },
] as const;

/**
 * Register commands and start the bot.
 *
 * Production (NODE_ENV !== development):
 *   Registers webhook at TELEGRAM_WEBHOOK_URL pointing to the Express app's
 *   /bot/webhook route. The Express app handles the actual webhook delivery —
 *   no separate HTTP server is needed.
 *
 * Development:
 *   Falls back to long-polling via bot.start().
 */
export async function initBot(): Promise<void> {
  logger.info(
    { commands: COMMANDS.map(c => `/${c.command}`).join(" ") },
    "Registering bot command menu with Telegram"
  );

  try {
    await bot.api.setMyCommands(COMMANDS);
    logger.info({ count: COMMANDS.length }, "setMyCommands succeeded");
  } catch (err) {
    // Log but don't crash the API — bot menu update failure is non-fatal
    logger.error({ err }, "setMyCommands failed");
  }

  if (env.isDev()) {
    await bot.api.deleteWebhook();
    logger.info("Bot starting in long-polling mode (development)");
    // Don't await — long-polling runs indefinitely and would block the API startup
    bot.start({
      onStart: (info) => logger.info({ username: info.username }, "Bot polling started"),
    }).catch((err) => logger.error({ err }, "Bot polling error"));
  } else {
    // Production: register webhook pointing to our Express route /bot/webhook
    const webhookUrl = env.TELEGRAM_WEBHOOK_URL.trim();
    const secretToken = env.TELEGRAM_WEBHOOK_SECRET.trim();

    if (!webhookUrl) {
      logger.warn("TELEGRAM_WEBHOOK_URL not set — bot webhook not registered");
      return;
    }

    await bot.api.setWebhook(webhookUrl, {
      secret_token:        secretToken || undefined,
      drop_pending_updates: false,
      allowed_updates:     ["message", "callback_query"],
    });

    logger.info({ webhookUrl }, "Bot webhook registered — updates delivered via Express /bot/webhook");
  }
}
