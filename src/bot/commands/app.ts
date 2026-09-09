import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";
import { mainKeyboard } from "../lib/keyboard.js";

export async function handleApp(ctx: Context): Promise<void> {
  const miniAppUrl = env.MINI_APP_URL;

  const inline = new InlineKeyboard();
  if (miniAppUrl) {
    inline.webApp("🚀 Open Connect Digitals", miniAppUrl);
  }

  await ctx.reply(
    `<b>Connect Digitals</b>\n\n` +
    `Your advertising journey starts here.\n\n` +
    `Access your campaigns, create promotions, manage payments, and track your advertising activity from one place.`,
    { parse_mode: "HTML", reply_markup: inline }
  );

  await ctx.reply("Use the menu below to continue.", { reply_markup: mainKeyboard() });
}
