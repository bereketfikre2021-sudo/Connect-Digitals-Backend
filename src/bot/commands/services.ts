import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";

export async function handleServices(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard();
  if (env.MINI_APP_URL) {
    keyboard.webApp("📦 Browse Services", env.MINI_APP_URL + "?startapp=services");
  }

  await ctx.reply(
    `<b>Promotion Services</b>\n\n` +
    `We offer growth services for:\n\n` +
    `📱 <b>TikTok</b> — Followers, Likes, Views\n` +
    `📸 <b>Instagram</b> — Followers, Likes, Views\n` +
    `📘 <b>Facebook</b> — Page Followers, Post Likes\n` +
    `▶️ <b>YouTube</b> — Subscribers, Video Views\n` +
    `📢 <b>Telegram</b> — Channel Members, Post Views\n` +
    `🌐 <b>Website</b> — Traffic\n\n` +
    `Tap below to see all packages and pricing.`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}


