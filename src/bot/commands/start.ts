import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";
import { BRAND } from "../../shared/index.js";

export async function handleStart(ctx: Context): Promise<void> {
  const firstName = ctx.from?.first_name ?? "there";
  const miniAppUrl = env.MINI_APP_URL;

  const keyboard = new InlineKeyboard();

  if (miniAppUrl) {
    keyboard.webApp("🚀 Open Connect Digitals", miniAppUrl);
  }

  await ctx.reply(
    `👋 Welcome to <b>Connect Digitals</b>, ${firstName}!\n\n` +
    `We help you grow your social media presence with professional promotion services.\n\n` +
    `<b>What we offer:</b>\n` +
    `📱 TikTok · Instagram · Facebook\n` +
    `▶️ YouTube · 📢 Telegram · 🌐 Website\n\n` +
    `Tap the button below to browse services, place orders, and track your campaigns.\n\n` +
    `Need help? Use /support`,
    {
      parse_mode: "HTML",
      reply_markup: keyboard,
    }
  );
}


