import { app, registerBotWebhook } from "./app.js";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { bot, initBot } from "./bot/bot.js";

const server = app.listen(env.PORT, async () => {
  logger.info(`API server running on port ${env.PORT} [${env.NODE_ENV}]`);

  // Register the bot webhook route on the Express app, then start the bot.
  // Done after the server is listening so the webhook URL is reachable.
  try {
    await registerBotWebhook(bot);
    await initBot();
  } catch (err) {
    // Bot startup failure must never crash the API
    logger.error({ err }, "Bot initialisation failed — API continues without bot");
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down");
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  logger.info("SIGINT received — shutting down");
  server.close(() => process.exit(0));
});
