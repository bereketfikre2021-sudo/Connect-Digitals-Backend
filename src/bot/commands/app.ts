import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";

export async function handleApp(ctx: Context): Promise<void> {
  const miniAppUrl = env.MINI_APP_URL;

  const keyboard = new InlineKeyboard();

  if (miniAppUrl) {
    keyboard.webApp("🚀 Open Connect Digitals", miniAppUrl);
  }

  await ctx.reply(
    `<b>Connect Digitals</b>\n\n` +
    `Your advertising journey starts here.\n\n` +
    `Access your campaigns, create promotions, manage payments, and track your advertising activity from one place.`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}
