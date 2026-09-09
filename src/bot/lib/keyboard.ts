/**
 * Persistent reply keyboard shown at the bottom of every chat.
 * Using ReplyKeyboard (not InlineKeyboard) so it stays permanently
 * visible — the same pattern used by bots like the one in the screenshot.
 *
 * The keyboard is sent with every command reply using reply_markup.
 * Telegram keeps it persistent until explicitly removed.
 */
import { Keyboard } from "grammy";

/**
 * Returns the main persistent keyboard.
 * All 5 buttons map to bot commands the user can tap to trigger.
 */
export function mainKeyboard(): Keyboard {
  return new Keyboard()
    .text("🚀 Open App").text("📊 My Campaigns")
    .row()
    .text("💳 My Wallet").text("❓ How It Works")
    .row()
    .text("💬 Support")
    .resized()      // fit the keyboard to button count — no empty space
    .persistent();  // stay visible until explicitly removed
}
