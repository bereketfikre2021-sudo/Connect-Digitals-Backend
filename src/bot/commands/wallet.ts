import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../lib/prisma.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { mainKeyboard } from "../lib/keyboard.js";

export async function handleWallet(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id);
  const miniAppUrl = env.MINI_APP_URL;

  const inline = new InlineKeyboard();
  if (miniAppUrl) {
    inline.webApp("💳 Open Wallet", miniAppUrl);
  }

  try {
    const identity = await prisma.telegramIdentity.findUnique({
      where: { telegramUserId },
      select: { userId: true },
    });

    if (!identity) {
      await ctx.reply(
        "You don't have an account yet. Use /start to open the app.",
        { reply_markup: mainKeyboard() }
      );
      return;
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: identity.userId },
      select: { balanceETB: true },
    });

    const balance = wallet ? (wallet.balanceETB / 100).toFixed(2) : "0.00";

    await ctx.reply(
      `<b>💳 Your Wallet</b>\n\n` +
      `Available Balance: <b>ETB ${balance}</b>\n\n` +
      `Manage your advertising balance and payment activity.\n\n` +
      `Add funds to your account and use your balance when launching campaigns.`,
      { parse_mode: "HTML", reply_markup: inline }
    );

    // Re-attach persistent keyboard after inline-button message
    await ctx.reply("Use the menu below to continue.", { reply_markup: mainKeyboard() });
  } catch (err) {
    logger.error({ err, telegramUserId }, "Failed to fetch wallet for /wallet");
    await ctx.reply(
      "Something went wrong while retrieving your information. Please try again shortly or contact support.",
      { reply_markup: mainKeyboard() }
    );
  }
}
