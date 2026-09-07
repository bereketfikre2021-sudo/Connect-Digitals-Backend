import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../lib/prisma.js";
import { env } from "../lib/env.js";

export async function handleWallet(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id);

  const keyboard = new InlineKeyboard();
  if (env.MINI_APP_URL) {
    keyboard.webApp("💰 Open Wallet", env.MINI_APP_URL + "?startapp=wallet");
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

    const balance = wallet ? (wallet.balanceETB / 100).toFixed(2) : "0.00";

    await ctx.reply(
      `<b>Your Wallet</b>\n\n` +
      `💰 Balance: <b>${balance} ETB</b>\n\n` +
      `Open the app to deposit funds or view your transaction history.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch {
    await ctx.reply("Unable to load wallet. Please try again.", { reply_markup: keyboard });
  }
}


