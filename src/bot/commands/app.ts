import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";

export async function handleApp(ctx: Context): Promise<void> {
  const miniAppUrl = env.MINI_APP_URL;

  if (!miniAppUrl) {
    await ctx.reply("The app is not available right now. Please try again later.");
    return;
  }

  // Single inline button that opens the Mini App directly —
  // this is the only Telegram mechanism that launches a Mini App.
  const inline = new InlineKeyboard().webApp("🚀 Open Connect Digitals", miniAppUrl);

  await ctx.reply(
    "Tap the button below to open Connect Digitals.",
    { reply_markup: inline }
  );
}
