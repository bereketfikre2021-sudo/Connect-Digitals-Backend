import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { env } from "../lib/env.js";
import { mainKeyboard } from "../lib/keyboard.js";

export async function handleStart(ctx: Context): Promise<void> {
  const miniAppUrl = env.MINI_APP_URL;

  // Inline buttons for quick actions within the message
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
    `<b>Welcome to Connect Digitals.</b>\n\n` +
    `Your brand deserves to be seen by the right people.\n\n` +
    `With Connect Digitals, you can create and manage digital advertising campaigns designed to amplify your content and expand your reach.\n\n` +
    `<b>What you can do:</b>\n` +
    `🎯 Promote your content\n` +
    `📈 Reach your target audience\n` +
    `💳 Manage payments\n` +
    `📊 Track your campaigns\n\n` +
    `Use the menu below to get started.`,
    { parse_mode: "HTML", reply_markup: mainKeyboard() }
  );
}
