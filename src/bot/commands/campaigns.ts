import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../lib/prisma.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export async function handleCampaigns(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id);
  const miniAppUrl = env.MINI_APP_URL;

  // ── Resolve user identity ─────────────────────────────────────────────────
  let userId: string;
  try {
    const identity = await prisma.telegramIdentity.findUnique({
      where: { telegramUserId },
      select: { userId: true },
    });

    if (!identity) {
      const keyboard = new InlineKeyboard();
      if (miniAppUrl) {
        keyboard.webApp("🚀 Open App", miniAppUrl);
      }
      await ctx.reply(
        "You don't have an account yet. Use /start to open the app and get started.",
        { reply_markup: keyboard }
      );
      return;
    }

    userId = identity.userId;
  } catch (err) {
    logger.error({ err, telegramUserId }, "Failed to look up Telegram identity for /campaigns");
    await ctx.reply(
      "Something went wrong while retrieving your information. Please try again shortly or contact support."
    );
    return;
  }

  // ── Fetch campaigns via Order → Campaign join ─────────────────────────────
  // Campaign records are linked to orders (Order → Campaign). Each campaign
  // belongs to a user through its order. We surface campaign info alongside
  // the service name for a readable summary.
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { order: { userId } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        internalStatus: true,
        budgetETB: true,
        createdAt: true,
        order: {
          select: {
            service: { select: { name: true } },
          },
        },
      },
    });

    // ── No campaigns ─────────────────────────────────────────────────────────
    if (campaigns.length === 0) {
      const keyboard = new InlineKeyboard();
      if (miniAppUrl) {
        keyboard.webApp("🚀 Create Your First Campaign", miniAppUrl);
      }
      await ctx.reply(
        `<b>📊 Your Campaigns</b>\n\n` +
        `You haven't launched a campaign yet.\n\n` +
        `Your next campaign could be the beginning of something bigger.`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
      return;
    }

    // ── Has campaigns ─────────────────────────────────────────────────────────
    const lines = campaigns.map((c) => {
      const status = formatCampaignStatus(c.internalStatus);
      const budget = c.budgetETB != null ? `ETB ${(c.budgetETB / 100).toFixed(2)}` : "Budget TBD";
      const name = escapeHtml(c.order.service.name);
      const date = c.createdAt.toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      return `• <b>${name}</b>\n  ${status} · ${budget} · ${date}`;
    });

    const keyboard = new InlineKeyboard();
    if (miniAppUrl) {
      keyboard.webApp("📊 View Campaigns", miniAppUrl);
    }

    await ctx.reply(
      `<b>📊 Your Campaigns</b>\n\n${lines.join("\n\n")}`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (err) {
    logger.error({ err, userId }, "Failed to fetch campaigns for /campaigns");
    await ctx.reply(
      "Something went wrong while retrieving your information. Please try again shortly or contact support."
    );
  }
}

function formatCampaignStatus(status: string): string {
  const map: Record<string, string> = {
    DRAFT:     "📝 Draft",
    ACTIVE:    "✅ Active",
    PAUSED:    "⏸ Paused",
    COMPLETED: "🏁 Completed",
    CANCELLED: "🚫 Cancelled",
    FAILED:    "❌ Failed",
  };
  return map[status] ?? status;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
