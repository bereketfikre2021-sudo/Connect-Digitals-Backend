/**
 * Telegram notification service.
 * Sends messages via the bot to a customer's Telegram chat.
 * Failures are logged but never thrown — a notification failure
 * must not roll back a financial transaction.
 */

import { Bot } from "grammy";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import type { NotificationEvent } from "../shared/index.js";

// Lazy-initialise the bot so the API can start without a valid token (dev/test)
let _bot: Bot | null = null;
function getBot(): Bot | null {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  if (!_bot) _bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  return _bot;
}

const MESSAGES: Record<string, (data: Record<string, string>) => string> = {
  ORDER_CREATED: (d) =>
    `📋 *Order Placed*\n\nOrder *${d["orderNumber"]}* has been placed.\n\nService: ${d["serviceName"]}\nAmount: *${d["amount"]} ETB*\n\nPlease complete your payment to proceed.`,
  PAYMENT_SUBMITTED: (d) =>
    `💳 *Payment Submitted*\n\nYour payment for order *${d["orderNumber"]}* is under review.\n\nAmount: *${d["amount"]} ETB*\nRef: ${d["reference"]}\n\nWe'll notify you once it's confirmed.`,
  PAYMENT_APPROVED: (d) =>
    `✅ *Payment Approved*\n\nYour payment for order *${d["orderNumber"]}* has been approved!\n\nAmount: *${d["amount"]} ETB*\n\nYour order is now being processed.`,
  PAYMENT_REJECTED: (d) =>
    `❌ *Payment Rejected*\n\nYour payment for order *${d["orderNumber"]}* was rejected.\n\nReason: ${d["reason"]}\n\nPlease re-submit your payment with a valid proof.`,
  ORDER_PROCESSING: (d) =>
    `⚙️ *Order Processing*\n\nOrder *${d["orderNumber"]}* is now being processed.\n\nService: ${d["serviceName"]}\n\nWe'll notify you when it's complete.`,
  FULFILLMENT_STARTED: (d) =>
    `🚀 *Fulfillment Started*\n\nWork has begun on order *${d["orderNumber"]}*.\n\nService: ${d["serviceName"]}\n\nEstimated delivery: ${d["deliveryDays"]} days.`,
  ORDER_COMPLETED: (d) =>
    `🎉 *Order Completed*\n\nOrder *${d["orderNumber"]}* has been completed!\n\nService: ${d["serviceName"]}\n\nThank you for using Connect Digitals.`,
  ORDER_CANCELLED: (d) =>
    `🚫 *Order Cancelled*\n\nOrder *${d["orderNumber"]}* has been cancelled.\n\nReason: ${d["reason"] ?? "No reason provided"}`,
  REFUND_ISSUED: (d) =>
    `↩️ *Refund Issued*\n\nA refund of *${d["amount"]} ETB* has been credited to your wallet for order *${d["orderNumber"]}*.`,
  REPORT_AVAILABLE: (d) =>
    `📊 *Report Ready*\n\nYour campaign report for order *${d["orderNumber"]}* is now available.\n\nOpen the app to view your results.`,
  WALLET_CREDITED: (d) =>
    `💰 *Wallet Credited*\n\nYour wallet has been credited *${d["amount"]} ETB*.\n\nNew balance: *${d["balance"]} ETB*`,
};

export async function sendNotification(
  userId: string,
  event: NotificationEvent | string,
  data: Record<string, string>
): Promise<void> {
  const title = event.replace(/_/g, " ");
  const message = MESSAGES[event]?.(data) ?? `Update on your order: ${title}`;

  // Persist notification record
  try {
    await prisma.notification.create({
      data: {
        userId,
        channel: "TELEGRAM",
        event: event as never,
        title,
        message,
        metadata: data as never,
      },
    });
  } catch (err) {
    logger.warn({ err, userId, event }, "Failed to persist notification record");
  }

  // Look up Telegram ID
  const identity = await prisma.telegramIdentity.findUnique({
    where: { userId },
    select: { telegramUserId: true },
  });

  if (!identity) {
    logger.warn({ userId, event }, "No Telegram identity for notification — skipping send");
    return;
  }

  const bot = getBot();
  if (!bot) {
    logger.warn({ userId, event }, "Bot not initialised — skipping Telegram send");
    return;
  }

  try {
    await bot.api.sendMessage(identity.telegramUserId, message, {
      parse_mode: "Markdown",
    });

    // Mark as sent
    await prisma.notification.updateMany({
      where: { userId, event: event as never, sentAt: null },
      data: { sentAt: new Date(), deliveredAt: new Date() },
    });
  } catch (err) {
    logger.error({ err, userId, event }, "Failed to send Telegram notification");
    await prisma.notification.updateMany({
      where: { userId, event: event as never, sentAt: null },
      data: { failedAt: new Date(), failureReason: String(err) },
    });
  }
}


