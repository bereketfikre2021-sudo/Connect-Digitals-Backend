import type { Context } from "grammy";

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    `<b>Connect Digitals — Help</b>\n\n` +
    `<b>Available commands:</b>\n` +
    `/start — Welcome message & open the app\n` +
    `/services — Browse promotion services\n` +
    `/orders — View your orders\n` +
    `/wallet — Check your balance\n` +
    `/profile — Your account details\n` +
    `/support — Contact our support team\n\n` +
    `<b>How it works:</b>\n` +
    `1. Open the app via /start\n` +
    `2. Browse and select a service\n` +
    `3. Choose a package\n` +
    `4. Submit your target link\n` +
    `5. Complete payment\n` +
    `6. Track your order\n\n` +
    `Questions? Use /support`,
    { parse_mode: "HTML" }
  );
}


