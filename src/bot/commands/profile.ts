import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../lib/prisma.js";
import { env } from "../lib/env.js";

export async function handleProfile(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id);

  const keyboard = new InlineKeyboard();
  if (env.MINI_APP_URL) {
    keyboard.webApp("👤 Open Profile", env.MINI_APP_URL + "?startapp=profile");
  }

  try {
    const identity = await prisma.telegramIdentity.findUnique({
      where: { telegramUserId },
      include: {
        user: {
          select: {
            createdAt: true,
            _count: { select: { orders: true } },
          },
        },
      },
    });

    if (!identity) {
      await ctx.reply(
        "You don't have an account yet. Use /start to get started.",
        { reply_markup: keyboard }
      );
      return;
    }

    const name = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
    const username = identity.username ? `@${identity.username}` : "No username";
    const joined = identity.user.createdAt.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });

    await ctx.reply(
      `<b>Your Profile</b>\n\n` +
      `👤 <b>${name}</b>\n` +
      `🔗 ${username}\n` +
      `📅 Member since: ${joined}\n` +
      `📦 Total orders: ${identity.user._count.orders}`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch {
    await ctx.reply("Unable to load profile. Please try again.", { reply_markup: keyboard });
  }
}


