import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";
import { mainKeyboard } from "../lib/keyboard.js";

export async function handleHelp(ctx: Context): Promise<void> {
  const miniAppUrl = env.MINI_APP_URL;

  const inline = new InlineKeyboard();
  if (miniAppUrl) {
    inline.webApp("🚀 Open App", miniAppUrl);
    inline.row();
  }
  inline
    .text("📋 How It Works", "how_it_works")
    .row()
    .text("💬 Support", "support_menu");

  await ctx.reply(
    `<b>❓ Connect Digitals Help</b>\n\n` +
    `<b>🚀 Getting Started</b>\n` +
    `Open the Mini App and create your first campaign.\n\n` +
    `<b>📊 Campaigns</b>\n` +
    `View and manage your advertising campaigns.\n\n` +
    `<b>💳 Payments</b>\n` +
    `Manage your wallet and payment activity.\n\n` +
    `<b>💬 Support</b>\n` +
    `Contact our support team whenever you need assistance.`,
    { parse_mode: "HTML", reply_markup: mainKeyboard() }
  );
}
