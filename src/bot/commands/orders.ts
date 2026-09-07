import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../lib/prisma.js";
import { env } from "../lib/env.js";

export async function handleOrders(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id);

  const keyboard = new InlineKeyboard();
  if (env.MINI_APP_URL) {
    keyboard.webApp("📋 View All Orders", env.MINI_APP_URL + "?startapp=orders");
  }

  try {
    const identity = await prisma.telegramIdentity.findUnique({
      where: { telegramUserId },
      select: { userId: true },
    });

    if (!identity) {
      await ctx.reply(
        "You don't have an account yet. Use /start to open the app and get started.",
        { reply_markup: keyboard }
      );
      return;
    }

    const orders = await prisma.order.findMany({
      where: { userId: identity.userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        orderNumber: true,
        orderStatus: true,
        paymentStatus: true,
        createdAt: true,
        service: { select: { name: true } },
      },
    });

    if (orders.length === 0) {
      await ctx.reply(
        "You haven't placed any orders yet.\n\nUse /services to browse our promotion packages.",
        { reply_markup: keyboard }
      );
      return;
    }

    const lines = orders.map((o) => {
      const status = formatOrderStatus(o.orderStatus, o.paymentStatus);
      return `• <b>${o.orderNumber}</b> — ${o.service.name}\n  ${status}`;
    });

    await ctx.reply(
      `<b>Your Recent Orders</b>\n\n${lines.join("\n\n")}\n\nTap below to see all orders and details.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch {
    await ctx.reply("Unable to load orders. Please try again.", { reply_markup: keyboard });
  }
}

function formatOrderStatus(orderStatus: string, paymentStatus: string): string {
  const map: Record<string, string> = {
    PENDING_PAYMENT: "⏳ Awaiting payment",
    PAYMENT_SUBMITTED: "🔍 Payment under review",
    PAYMENT_APPROVED: "✅ Payment approved",
    PAYMENT_REJECTED: "❌ Payment rejected",
    PROCESSING: "⚙️ Processing",
    IN_PROGRESS: "🚀 In progress",
    COMPLETED: "✅ Completed",
    CANCELLED: "🚫 Cancelled",
    REFUNDED: "↩️ Refunded",
  };
  return map[orderStatus] ?? orderStatus;
}



