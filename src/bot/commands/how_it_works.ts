import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";

export async function handleHowItWorks(ctx: Context): Promise<void> {
  const miniAppUrl = env.MINI_APP_URL;

  const keyboard = new InlineKeyboard();
  if (miniAppUrl) {
    keyboard.webApp("🚀 Start Advertising", miniAppUrl);
  }

  await ctx.reply(
    `<b>📋 How Connect Digitals Works</b>\n\n` +
    `<b>01 · Choose</b>\n` +
    `Select the content or promotion you want to advertise.\n\n` +
    `<b>02 · Define</b>\n` +
    `Set your audience, budget, duration, and campaign preferences.\n\n` +
    `<b>03 · Fund</b>\n` +
    `Complete your payment or use your available wallet balance.\n\n` +
    `<b>04 · Review</b>\n` +
    `Your campaign is reviewed and prepared for launch.\n\n` +
    `<b>05 · Launch</b>\n` +
    `Once approved, your campaign goes live.\n\n` +
    `<b>06 · Track</b>\n` +
    `Monitor your campaign and stay updated from your dashboard.\n\n` +
    `Ready to get started?`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}
