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
import { handleStart } from "./commands/start.js";
import { handleHelp } from "./commands/help.js";
import { handleServices } from "./commands/services.js";
import { handleOrders } from "./commands/orders.js";
import { handleWallet } from "./commands/wallet.js";
import { handleProfile } from "./commands/profile.js";
import { handleSupport } from "./commands/support.js";

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// ── Commands ─────────────────────────────────────────────────────────────────
bot.command("start", handleStart);
bot.command("help", handleHelp);
bot.command("services", handleServices);
bot.command("orders", handleOrders);
bot.command("wallet", handleWallet);
bot.command("profile", handleProfile);
bot.command("support", handleSupport);

// ── Fallback ─────────────────────────────────────────────────────────────────
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
  // Set the Telegram command menu (idempotent)
  await bot.api.setMyCommands([
    { command: "start",    description: "Welcome & open the app" },
    { command: "services", description: "Browse promotion services" },
    { command: "orders",   description: "View your orders" },
    { command: "wallet",   description: "Check your wallet balance" },
    { command: "profile",  description: "Your account details" },
    { command: "help",     description: "How to use this bot" },
    { command: "support",  description: "Contact support" },
  ]);

  if (env.isDev()) {
    // ── Development: long-polling ─────────────────────────────────────────────
    // Delete any stale webhook so polling works cleanly
    await bot.api.deleteWebhook();
    logger.info({ username: env.TELEGRAM_BOT_USERNAME || "unknown" }, "Starting bot in long-polling mode (development)");
    await bot.start({
      onStart: (info) => logger.info({ username: info.username }, "Bot running"),
    });
  } else {
    // ── Production: webhook mode ──────────────────────────────────────────────
    // Requires TELEGRAM_WEBHOOK_URL (public HTTPS URL this bot process is reachable at)
    if (!env.TELEGRAM_WEBHOOK_URL) {
      throw new Error("Missing required environment variable: TELEGRAM_WEBHOOK_URL");
    }
    if (!env.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error("Missing required environment variable: TELEGRAM_WEBHOOK_SECRET");
    }

    const webhookUrl = env.TELEGRAM_WEBHOOK_URL;
    const secretToken = env.TELEGRAM_WEBHOOK_SECRET;

    // Register the webhook with Telegram (idempotent — safe to call on every start)
    await bot.api.setWebhook(webhookUrl, {
      secret_token: secretToken,
      drop_pending_updates: false,   // keep pending updates so nothing is lost on restart
      allowed_updates: ["message", "callback_query"],
    });

    logger.info({ webhookUrl }, "Webhook registered with Telegram");

    // Build the grammY webhook handler
    const handleUpdate = webhookCallback(bot, "http", {
      secretToken,
      timeoutMilliseconds: 10_000,
    });

    // Start a minimal HTTP server to receive Telegram updates
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

    // Graceful shutdown
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
