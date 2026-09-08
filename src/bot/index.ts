/**
 * Connect Digitals Telegram Bot
 *
 * Development: long-polling (bot.start())
 * Production:  webhook mode — bot listens on its own HTTP port,
 *              Telegram pushes updates to TELEGRAM_WEBHOOK_URL.
 *
 * The bot token is only ever used server-side.
 * The webhook secret token is verified on every incoming request.
 */

import http from "http";
import { Bot, BotError, GrammyError, HttpError, webhookCallback } from "grammy";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { handleStart }       from "./commands/start.js";
import { handleApp }         from "./commands/app.js";
import { handleCampaigns }   from "./commands/campaigns.js";
import { handleWallet }      from "./commands/wallet.js";
import { handleHowItWorks }  from "./commands/how_it_works.js";
import { handleSupport }     from "./commands/support.js";
import { handleHelp }        from "./commands/help.js";
// Preserved existing commands
import { handleOrders }      from "./commands/orders.js";
import { handleProfile }     from "./commands/profile.js";
import { handleServices }    from "./commands/services.js";
// Callback query handlers
import {
  handleCallbackHowItWorks,
  handleCallbackSupportMenu,
  handleCallbackSupportCampaign,
  handleCallbackSupportPayment,
  handleCallbackSupportAccount,
  handleCallbackSupportContact,
  handleUnknownCallback,
} from "./commands/callbacks.js";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// ── Commands ──────────────────────────────────────────────────────────────────
// New spec commands
bot.command("start",        handleStart);
bot.command("app",          handleApp);
bot.command("campaigns",    handleCampaigns);
bot.command("wallet",       handleWallet);
bot.command("how_it_works", handleHowItWorks);
bot.command("support",      handleSupport);
bot.command("help",         handleHelp);
// Preserved existing commands (not in the spec menu, kept for compatibility)
bot.command("orders",       handleOrders);
bot.command("profile",      handleProfile);
bot.command("services",     handleServices);

// ── Callback query handlers ───────────────────────────────────────────────────
bot.callbackQuery("how_it_works",    handleCallbackHowItWorks);
bot.callbackQuery("support_menu",    handleCallbackSupportMenu);
bot.callbackQuery("support_campaign", handleCallbackSupportCampaign);
bot.callbackQuery("support_payment",  handleCallbackSupportPayment);
bot.callbackQuery("support_account",  handleCallbackSupportAccount);
bot.callbackQuery("support_contact",  handleCallbackSupportContact);

// Catch-all for any unknown/stale callback data — must come after named handlers
bot.on("callback_query:data", handleUnknownCallback);

// ── Fallback message handler ──────────────────────────────────────────────────
bot.on("message", async (ctx) => {
  await ctx.reply(
    "I didn't understand that. Use /help to see available commands, or /start to open the app."
  );
});

// ── Error handling ────────────────────────────────────────────────────────────
bot.catch((err: BotError) => {
  const ctx = err.ctx;
  logger.error({ updateId: ctx.update.update_id }, "Error handling Telegram update");

  if (err.error instanceof GrammyError) {
    logger.error({ description: err.error.description }, "grammY error");
  } else if (err.error instanceof HttpError) {
    logger.error({ message: err.error.message }, "HTTP error");
  } else {
    logger.error(err.error, "Unknown bot error");
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  // ── Register command menu with Telegram ────────────────────────────────────
  // Uses the default scope (BotCommandScopeDefault) which makes the commands
  // visible globally to all users in all chat types. No scope parameter means
  // Telegram shows the menu to every user automatically.
  // Preserved commands (/orders, /profile, /services) are not listed in the
  // BotFather menu per the spec but remain fully functional via direct input.
  const COMMANDS = [
    { command: "start",        description: "🚀 Start your advertising journey" },
    { command: "app",          description: "📱 Open Connect Digitals" },
    { command: "campaigns",    description: "📊 View your campaigns" },
    { command: "wallet",       description: "💳 View your balance & payments" },
    { command: "how_it_works", description: "📋 Learn how it works" },
    { command: "support",      description: "💬 Get customer support" },
    { command: "help",         description: "❓ Get help" },
  ] as const;

  logger.info(
    { commands: COMMANDS.map((c) => `/${c.command}`).join(" ") },
    "Registering bot command menu with Telegram (global/default scope)"
  );

  try {
    await bot.api.setMyCommands(COMMANDS);
    logger.info(
      { count: COMMANDS.length, scope: "default" },
      "setMyCommands succeeded — command menu is live"
    );
  } catch (err) {
    logger.error({ err }, "setMyCommands FAILED — bot will not start");
    throw err;
  }

  if (env.isDev()) {
    // ── Development: long-polling ─────────────────────────────────────────────
    await bot.api.deleteWebhook();
    logger.info({ username: env.TELEGRAM_BOT_USERNAME || "unknown" }, "Starting bot in long-polling mode (development)");
    await bot.start({
      onStart: (info) => logger.info({ username: info.username }, "Bot running"),
    });
  } else {
    // ── Production: webhook mode ──────────────────────────────────────────────
    if (!env.TELEGRAM_WEBHOOK_URL) {
      throw new Error("Missing required environment variable: TELEGRAM_WEBHOOK_URL");
    }
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error("Missing required environment variable: TELEGRAM_WEBHOOK_SECRET");
    }

    const webhookUrl = env.TELEGRAM_WEBHOOK_URL;
    const secretToken = env.TELEGRAM_WEBHOOK_SECRET;

    await bot.api.setWebhook(webhookUrl, {
      secret_token: secretToken,
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"],
    });

    logger.info({ webhookUrl }, "Webhook registered with Telegram");

    const handleUpdate = webhookCallback(bot, "http", {
      secretToken,
      timeoutMilliseconds: 10_000,
    });

    const port = env.BOT_PORT;
    const server = http.createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/") {
        try {
          await handleUpdate(req, res);
        } catch (err) {
          logger.error(err, "Webhook handler error");
          res.writeHead(500).end();
        }
      } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ status: "ok", mode: "webhook" }));
      } else {
        res.writeHead(404).end();
      }
    });

    server.listen(port, () => {
      logger.info({ port, mode: "webhook" }, `Bot webhook server running on port ${port}`);
    });

    const shutdown = async () => {
      logger.info("Bot shutting down — removing webhook");
      try { await bot.api.deleteWebhook(); } catch { /* best-effort */ }
      server.close(() => process.exit(0));
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT",  shutdown);
  }
}

start().catch((err) => {
  logger.error(err, "Bot failed to start");
  process.exit(1);
});
