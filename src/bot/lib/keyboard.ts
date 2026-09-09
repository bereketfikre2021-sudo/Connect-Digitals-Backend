import { Keyboard } from "grammy";

// Button labels — must match exactly what bot.hears() listens for
export const KB = {
  OPEN_APP:     "Open App",
  MY_CAMPAIGNS: "My Campaigns",
  MY_WALLET:    "My Wallet",
  HOW_IT_WORKS: "How It Works",
  SUPPORT:      "Support",
} as const;

/**
 * Persistent reply keyboard — stays locked to the bottom of the chat.
 * Uses plain text labels (no emojis) to avoid encoding issues across platforms.
 * Telegram renders these as standard keyboard buttons.
 */
export function mainKeyboard(): Keyboard {
  return new Keyboard()
    .text(KB.OPEN_APP).text(KB.MY_CAMPAIGNS)
    .row()
    .text(KB.MY_WALLET).text(KB.HOW_IT_WORKS)
    .row()
    .text(KB.SUPPORT)
    .resized()
    .persistent();
}
