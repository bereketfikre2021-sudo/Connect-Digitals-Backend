import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../lib/prisma.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export async function handleWallet(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id);
  const miniAppUrl = env.MINI_APP_URL;

  const keyboard = new InlineKeyboard();
  if (miniAppUrl) {
    keyboard.webApp("💳 Open Wallet", miniAppUrl);
  }

  try {
    const identity = await prisma.telegramIdentity.findUnique({
      where: { telegramUserId },
      select: { userId: true },
    });

    if (!identity) {
      await ctx.reply(
        "You don't have an account yet. Use /start to open the app.",
        { reply_markup: keyboard }
      );
      return;
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: identity.userId },
      select: { balanceETB: true },
    });

    // balanceETB is stored in cents (integer). Display as ETB X.XX.
    const balance = wallet ? (wallet.balanceETB / 100).toFixed(2) : "0.00";

    await ctx.reply(
      `<b>💳 Your Wallet</b>\n\n` +
      `Available Balance: <b>ETB ${balance}</b>\n\n` +
      `Manage your advertising balance and payment activity.\n\n` +
      `Add funds to your account and use your balance when launching campaigns.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (err) {
    logger.error({ err, telegramUserId }, "Failed to fetch wallet for /wallet");
    await ctx.reply(
      "Something went wrong while retrieving your information. Please try again shortly or contact support."
    );
  }
}
