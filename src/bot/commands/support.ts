import type { Context } from "grammy";

export async function handleSupport(ctx: Context): Promise<void> {
  await ctx.reply(
    `<b>Connect Digitals Support</b>\n\n` +
    `Need help with your order or account?\n\n` +
    `📧 Email: support@connectdigitals.com\n` +
    `⏰ Response time: within 24 hours\n\n` +
    `<b>Common issues:</b>\n` +
    `• Payment not confirmed — allow up to 24h for review\n` +
    `• Order not started — contact us with your order number\n` +
    `• Refund request — include your order number\n\n` +
    `Please include your order number when contacting us for faster assistance.`,
    { parse_mode: "HTML" }
  );
}


