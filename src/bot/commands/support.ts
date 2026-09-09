import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { mainKeyboard } from "../lib/keyboard.js";

export async function handleSupport(ctx: Context): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("📊 Campaign Support",  "support_campaign")
    .row()
    .text("💳 Payment Support",   "support_payment")
    .row()
    .text("👤 Account Support",   "support_account")
    .row()
    .text("💬 Contact Support",   "support_contact");

  await ctx.reply(
    `<b>💬 Connect Digitals Support</b>\n\n` +
    `Need assistance with a campaign, payment, account, or anything else?\n\n` +
    `Our support team is here to help.\n\n` +
    `What do you need help with?`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );

  // Re-attach the persistent keyboard so it stays visible after the inline reply
  await ctx.reply("Tap an option above or use the menu below.", { reply_markup: mainKeyboard() });
}
