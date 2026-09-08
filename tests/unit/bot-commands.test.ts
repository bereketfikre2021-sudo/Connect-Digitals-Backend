/**
 * Unit tests — Telegram bot command handlers
 *
 * All Prisma access and env dependencies are mocked so no real DB or
 * Telegram connection is needed. Tests verify:
 *  - Correct message content for each command
 *  - Correct inline keyboard presence (webApp / callback buttons)
 *  - Unauthenticated user path (no TelegramIdentity record)
 *  - Backend / DB failure path (graceful error message)
 *  - Callback query handlers acknowledge, respond, and never crash
 *  - Unknown callback data is handled silently
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mock env ──────────────────────────────────────────────────────────────────
vi.mock("../../src/bot/lib/env.js", () => ({
  env: {
    NODE_ENV: "test",
    TELEGRAM_BOT_TOKEN: "test_token",
    TELEGRAM_BOT_USERNAME: "testbot",
    TELEGRAM_WEBHOOK_URL: "",
    TELEGRAM_WEBHOOK_SECRET: "",
    BOT_PORT: 3001,
    MINI_APP_URL: "https://app.connectdigitals.com",
    LOG_LEVEL: "silent",
    isDev: () => false,
  },
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("../../src/bot/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Mock prisma ───────────────────────────────────────────────────────────────
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    telegramIdentity: { findUnique: vi.fn() },
    wallet:           { findUnique: vi.fn() },
    campaign:         { findMany:   vi.fn() },
  },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { prisma } from "../../src/lib/prisma.js";
import { handleStart }      from "../../src/bot/commands/start.js";
import { handleApp }        from "../../src/bot/commands/app.js";
import { handleCampaigns }  from "../../src/bot/commands/campaigns.js";
import { handleWallet }     from "../../src/bot/commands/wallet.js";
import { handleHowItWorks } from "../../src/bot/commands/how_it_works.js";
import { handleSupport }    from "../../src/bot/commands/support.js";
import { handleHelp }       from "../../src/bot/commands/help.js";
import {
  handleCallbackHowItWorks,
  handleCallbackSupportMenu,
  handleCallbackSupportCampaign,
  handleCallbackSupportPayment,
  handleCallbackSupportAccount,
  handleCallbackSupportContact,
  handleUnknownCallback,
} from "../../src/bot/commands/callbacks.js";

// ── Context factory ───────────────────────────────────────────────────────────

/**
 * Builds a minimal grammY-like Context mock.
 * Captures every ctx.reply() call so tests can assert on the sent text
 * and reply_markup without a real Telegram connection.
 */
function makeCtx(telegramUserId = "123456789", firstName = "Test"): {
  ctx: {
    from: { id: number; first_name: string };
    reply: Mock;
    answerCallbackQuery: Mock;
    callbackQuery: { data: string };
  };
  replies: Array<{ text: string; options?: unknown }>;
} {
  const replies: Array<{ text: string; options?: unknown }> = [];
  const ctx = {
    from: { id: Number(telegramUserId), first_name: firstName },
    reply: vi.fn(async (text: string, options?: unknown) => {
      replies.push({ text, options });
    }),
    answerCallbackQuery: vi.fn(async () => undefined),
    callbackQuery: { data: "" },
  };
  return { ctx, replies };
}

/**
 * Returns true if the reply_markup contains an inline_keyboard row with a
 * button whose text matches the given label.
 */
function hasButton(options: unknown, label: string): boolean {
  if (!options || typeof options !== "object") return false;
  const rm = (options as Record<string, unknown>)["reply_markup"];
  if (!rm || typeof rm !== "object") return false;
  // grammY InlineKeyboard serialises to { inline_keyboard: Button[][] }
  const ik = (rm as Record<string, unknown>)["inline_keyboard"];
  if (!Array.isArray(ik)) return false;
  return (ik as unknown[][]).some((row) =>
    Array.isArray(row) &&
    row.some((btn) => typeof btn === "object" && btn !== null && (btn as Record<string, unknown>)["text"] === label)
  );
}

function hasWebAppButton(options: unknown, label: string): boolean {
  if (!options || typeof options !== "object") return false;
  const rm = (options as Record<string, unknown>)["reply_markup"];
  if (!rm || typeof rm !== "object") return false;
  const ik = (rm as Record<string, unknown>)["inline_keyboard"];
  if (!Array.isArray(ik)) return false;
  return (ik as unknown[][]).some((row) =>
    Array.isArray(row) &&
    row.some(
      (btn) =>
        typeof btn === "object" &&
        btn !== null &&
        (btn as Record<string, unknown>)["text"] === label &&
        (btn as Record<string, unknown>)["web_app"] != null
    )
  );
}

function hasCallbackButton(options: unknown, label: string, data: string): boolean {
  if (!options || typeof options !== "object") return false;
  const rm = (options as Record<string, unknown>)["reply_markup"];
  if (!rm || typeof rm !== "object") return false;
  const ik = (rm as Record<string, unknown>)["inline_keyboard"];
  if (!Array.isArray(ik)) return false;
  return (ik as unknown[][]).some((row) =>
    Array.isArray(row) &&
    row.some(
      (btn) =>
        typeof btn === "object" &&
        btn !== null &&
        (btn as Record<string, unknown>)["text"] === label &&
        (btn as Record<string, unknown>)["callback_data"] === data
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// /start
// ─────────────────────────────────────────────────────────────────────────────
describe("/start — handleStart", () => {
  it("sends the onboarding message", async () => {
    const { ctx, replies } = makeCtx();
    await handleStart(ctx as never);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain("Welcome to Connect Digitals");
  });

  it("includes the brand value propositions", async () => {
    const { ctx, replies } = makeCtx();
    await handleStart(ctx as never);
    expect(replies[0]!.text).toContain("Promote your content");
    expect(replies[0]!.text).toContain("Reach your target audience");
    expect(replies[0]!.text).toContain("Manage payments");
    expect(replies[0]!.text).toContain("Track your campaigns");
  });

  it("has a webApp Open App button", async () => {
    const { ctx, replies } = makeCtx();
    await handleStart(ctx as never);
    expect(hasWebAppButton(replies[0]!.options, "🚀 Open App")).toBe(true);
  });

  it("has a How It Works callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleStart(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "📋 How It Works", "how_it_works")).toBe(true);
  });

  it("has a Support callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleStart(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "💬 Support", "support_menu")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /app
// ─────────────────────────────────────────────────────────────────────────────
describe("/app — handleApp", () => {
  it("sends the app introduction message", async () => {
    const { ctx, replies } = makeCtx();
    await handleApp(ctx as never);
    expect(replies[0]!.text).toContain("Connect Digitals");
    expect(replies[0]!.text).toContain("advertising journey starts here");
  });

  it("has a webApp Open Connect Digitals button", async () => {
    const { ctx, replies } = makeCtx();
    await handleApp(ctx as never);
    expect(hasWebAppButton(replies[0]!.options, "🚀 Open Connect Digitals")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /campaigns
// ─────────────────────────────────────────────────────────────────────────────
describe("/campaigns — handleCampaigns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows no-account message when user has no TelegramIdentity", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue(null);
    const { ctx, replies } = makeCtx();
    await handleCampaigns(ctx as never);
    expect(replies[0]!.text).toContain("don't have an account yet");
  });

  it("shows no-campaigns message when user has no campaigns", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.campaign.findMany as Mock).mockResolvedValue([]);
    const { ctx, replies } = makeCtx();
    await handleCampaigns(ctx as never);
    expect(replies[0]!.text).toContain("haven't launched a campaign yet");
    expect(replies[0]!.text).toContain("Your Campaigns");
    // Empty-state button opens Mini App
    expect(hasWebAppButton(replies[0]!.options, "🚀 Create Your First Campaign")).toBe(true);
  });

  it("shows campaign list when campaigns exist", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.campaign.findMany as Mock).mockResolvedValue([
      {
        internalStatus: "ACTIVE",
        budgetETB: 10000,
        createdAt: new Date("2026-01-15"),
        order: { service: { name: "TikTok Promotion" } },
      },
    ]);
    const { ctx, replies } = makeCtx();
    await handleCampaigns(ctx as never);
    expect(replies[0]!.text).toContain("TikTok Promotion");
    expect(replies[0]!.text).toContain("Active");
    expect(replies[0]!.text).toContain("ETB 100.00");
  });

  it("shows exactly the authenticated user's campaigns — no other userId", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user-ABC" });
    (prisma.campaign.findMany as Mock).mockResolvedValue([]);
    const { ctx } = makeCtx("999999");
    await handleCampaigns(ctx as never);
    const call = (prisma.campaign.findMany as Mock).mock.calls[0] as [unknown];
    const query = call[0] as Record<string, unknown>;
    // The where clause must scope to the resolved userId, not the raw telegramUserId
    expect(JSON.stringify(query["where"])).toContain("user-ABC");
    expect(JSON.stringify(query["where"])).not.toContain("999999");
  });

  it("shows graceful error message when Prisma identity lookup throws", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockRejectedValue(new Error("DB connection lost"));
    const { ctx, replies } = makeCtx();
    await handleCampaigns(ctx as never);
    expect(replies[0]!.text).toContain("Something went wrong");
    expect(replies[0]!.text).not.toContain("DB connection lost");
  });

  it("shows graceful error message when campaign fetch throws", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.campaign.findMany as Mock).mockRejectedValue(new Error("timeout"));
    const { ctx, replies } = makeCtx();
    await handleCampaigns(ctx as never);
    expect(replies[0]!.text).toContain("Something went wrong");
    expect(replies[0]!.text).not.toContain("timeout");
  });

  it("shows View Campaigns button when campaigns exist", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.campaign.findMany as Mock).mockResolvedValue([
      {
        internalStatus: "DRAFT",
        budgetETB: null,
        createdAt: new Date("2026-02-01"),
        order: { service: { name: "Instagram Boost" } },
      },
    ]);
    const { ctx, replies } = makeCtx();
    await handleCampaigns(ctx as never);
    expect(hasWebAppButton(replies[0]!.options, "📊 View Campaigns")).toBe(true);
  });

  it("handles null budgetETB gracefully", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.campaign.findMany as Mock).mockResolvedValue([
      {
        internalStatus: "DRAFT",
        budgetETB: null,
        createdAt: new Date("2026-03-01"),
        order: { service: { name: "Promo Test" } },
      },
    ]);
    const { ctx, replies } = makeCtx();
    await handleCampaigns(ctx as never);
    expect(replies[0]!.text).toContain("Budget TBD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /wallet
// ─────────────────────────────────────────────────────────────────────────────
describe("/wallet — handleWallet", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows no-account message when user has no TelegramIdentity", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue(null);
    const { ctx, replies } = makeCtx();
    await handleWallet(ctx as never);
    expect(replies[0]!.text).toContain("don't have an account yet");
  });

  it("shows actual wallet balance from DB (in cents, displayed as ETB)", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.wallet.findUnique as Mock).mockResolvedValue({ balanceETB: 25050 });
    const { ctx, replies } = makeCtx();
    await handleWallet(ctx as never);
    expect(replies[0]!.text).toContain("ETB 250.50");
    expect(replies[0]!.text).toContain("Your Wallet");
  });

  it("shows 0.00 balance when wallet record has zero balance", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.wallet.findUnique as Mock).mockResolvedValue({ balanceETB: 0 });
    const { ctx, replies } = makeCtx();
    await handleWallet(ctx as never);
    expect(replies[0]!.text).toContain("ETB 0.00");
  });

  it("shows 0.00 balance when wallet record is null", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.wallet.findUnique as Mock).mockResolvedValue(null);
    const { ctx, replies } = makeCtx();
    await handleWallet(ctx as never);
    expect(replies[0]!.text).toContain("ETB 0.00");
  });

  it("has an Open Wallet webApp button", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.wallet.findUnique as Mock).mockResolvedValue({ balanceETB: 1000 });
    const { ctx, replies } = makeCtx();
    await handleWallet(ctx as never);
    expect(hasWebAppButton(replies[0]!.options, "💳 Open Wallet")).toBe(true);
  });

  it("does not expose sensitive data in error reply", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockRejectedValue(
      new Error("Connection refused: user=admin password=secret123")
    );
    const { ctx, replies } = makeCtx();
    await handleWallet(ctx as never);
    expect(replies[0]!.text).toContain("Something went wrong");
    expect(replies[0]!.text).not.toContain("password");
    expect(replies[0]!.text).not.toContain("secret123");
  });

  it("shows graceful error when wallet fetch throws", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "user1" });
    (prisma.wallet.findUnique as Mock).mockRejectedValue(new Error("DB unavailable"));
    const { ctx, replies } = makeCtx();
    await handleWallet(ctx as never);
    expect(replies[0]!.text).toContain("Something went wrong");
    expect(replies[0]!.text).not.toContain("DB unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /how_it_works
// ─────────────────────────────────────────────────────────────────────────────
describe("/how_it_works — handleHowItWorks", () => {
  it("sends the 6-step guide", async () => {
    const { ctx, replies } = makeCtx();
    await handleHowItWorks(ctx as never);
    const text = replies[0]!.text;
    expect(text).toContain("How Connect Digitals Works");
    expect(text).toContain("01 · Choose");
    expect(text).toContain("02 · Define");
    expect(text).toContain("03 · Fund");
    expect(text).toContain("04 · Review");
    expect(text).toContain("05 · Launch");
    expect(text).toContain("06 · Track");
  });

  it("has a Start Advertising webApp button", async () => {
    const { ctx, replies } = makeCtx();
    await handleHowItWorks(ctx as never);
    expect(hasWebAppButton(replies[0]!.options, "🚀 Start Advertising")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /support
// ─────────────────────────────────────────────────────────────────────────────
describe("/support — handleSupport", () => {
  it("sends the support menu message", async () => {
    const { ctx, replies } = makeCtx();
    await handleSupport(ctx as never);
    expect(replies[0]!.text).toContain("Connect Digitals Support");
    expect(replies[0]!.text).toContain("What do you need help with");
  });

  it("has Campaign Support callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleSupport(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "📊 Campaign Support", "support_campaign")).toBe(true);
  });

  it("has Payment Support callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleSupport(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "💳 Payment Support", "support_payment")).toBe(true);
  });

  it("has Account Support callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleSupport(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "👤 Account Support", "support_account")).toBe(true);
  });

  it("has Contact Support callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleSupport(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "💬 Contact Support", "support_contact")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /help
// ─────────────────────────────────────────────────────────────────────────────
describe("/help — handleHelp", () => {
  it("sends the help message with all sections", async () => {
    const { ctx, replies } = makeCtx();
    await handleHelp(ctx as never);
    const text = replies[0]!.text;
    expect(text).toContain("Connect Digitals Help");
    expect(text).toContain("Getting Started");
    expect(text).toContain("Campaigns");
    expect(text).toContain("Payments");
    expect(text).toContain("Support");
  });

  it("has a webApp Open App button", async () => {
    const { ctx, replies } = makeCtx();
    await handleHelp(ctx as never);
    expect(hasWebAppButton(replies[0]!.options, "🚀 Open App")).toBe(true);
  });

  it("has a How It Works callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleHelp(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "📋 How It Works", "how_it_works")).toBe(true);
  });

  it("has a Support callback button", async () => {
    const { ctx, replies } = makeCtx();
    await handleHelp(ctx as never);
    expect(hasCallbackButton(replies[0]!.options, "💬 Support", "support_menu")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Callback query handlers
// ─────────────────────────────────────────────────────────────────────────────
describe("Callback query handlers", () => {
  /**
   * Builds a minimal callback context mock.
   * answerCallbackQuery is the key method that MUST be called on every callback.
   */
  function makeCallbackCtx(data = "how_it_works") {
    const replies: Array<{ text: string; options?: unknown }> = [];
    const ctx = {
      from: { id: 123456789, first_name: "Test" },
      reply: vi.fn(async (text: string, options?: unknown) => {
        replies.push({ text, options });
      }),
      answerCallbackQuery: vi.fn(async () => undefined),
      callbackQuery: { data },
    };
    return { ctx, replies };
  }

  describe("handleCallbackHowItWorks", () => {
    it("acknowledges the callback query", async () => {
      const { ctx } = makeCallbackCtx("how_it_works");
      await handleCallbackHowItWorks(ctx as never);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
    });

    it("sends the how it works content", async () => {
      const { ctx, replies } = makeCallbackCtx("how_it_works");
      await handleCallbackHowItWorks(ctx as never);
      expect(replies[0]!.text).toContain("How Connect Digitals Works");
      expect(replies[0]!.text).toContain("01 · Choose");
      expect(replies[0]!.text).toContain("06 · Track");
    });

    it("does not crash when answerCallbackQuery rejects (stale callback)", async () => {
      const { ctx, replies } = makeCallbackCtx("how_it_works");
      ctx.answerCallbackQuery.mockRejectedValue(new Error("query is too old"));
      // Should NOT throw — stale callbacks are swallowed
      await expect(handleCallbackHowItWorks(ctx as never)).resolves.toBeUndefined();
      // Still sends the content reply
      expect(replies[0]!.text).toContain("How Connect Digitals Works");
    });
  });

  describe("handleCallbackSupportMenu", () => {
    it("acknowledges the callback query", async () => {
      const { ctx } = makeCallbackCtx("support_menu");
      await handleCallbackSupportMenu(ctx as never);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
    });

    it("sends the support menu with all 4 category buttons", async () => {
      const { ctx, replies } = makeCallbackCtx("support_menu");
      await handleCallbackSupportMenu(ctx as never);
      expect(replies[0]!.text).toContain("Connect Digitals Support");
      expect(hasCallbackButton(replies[0]!.options, "📊 Campaign Support", "support_campaign")).toBe(true);
      expect(hasCallbackButton(replies[0]!.options, "💳 Payment Support",  "support_payment")).toBe(true);
      expect(hasCallbackButton(replies[0]!.options, "👤 Account Support",  "support_account")).toBe(true);
      expect(hasCallbackButton(replies[0]!.options, "💬 Contact Support",  "support_contact")).toBe(true);
    });
  });

  describe("handleCallbackSupportCampaign", () => {
    it("acknowledges and sends campaign support info", async () => {
      const { ctx, replies } = makeCallbackCtx("support_campaign");
      await handleCallbackSupportCampaign(ctx as never);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      expect(replies[0]!.text).toContain("Campaign Support");
      expect(replies[0]!.text).toContain("support@connectdigitals.com");
    });
  });

  describe("handleCallbackSupportPayment", () => {
    it("acknowledges and sends payment support info", async () => {
      const { ctx, replies } = makeCallbackCtx("support_payment");
      await handleCallbackSupportPayment(ctx as never);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      expect(replies[0]!.text).toContain("Payment Support");
      expect(replies[0]!.text).toContain("support@connectdigitals.com");
    });
  });

  describe("handleCallbackSupportAccount", () => {
    it("acknowledges and sends account support info", async () => {
      const { ctx, replies } = makeCallbackCtx("support_account");
      await handleCallbackSupportAccount(ctx as never);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      expect(replies[0]!.text).toContain("Account Support");
      expect(replies[0]!.text).toContain("support@connectdigitals.com");
    });
  });

  describe("handleCallbackSupportContact", () => {
    it("acknowledges and sends contact support info", async () => {
      const { ctx, replies } = makeCallbackCtx("support_contact");
      await handleCallbackSupportContact(ctx as never);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      expect(replies[0]!.text).toContain("Contact Support");
      expect(replies[0]!.text).toContain("support@connectdigitals.com");
    });

    it("does not expose internal URLs, env vars, or stack traces", async () => {
      const { ctx, replies } = makeCallbackCtx("support_contact");
      await handleCallbackSupportContact(ctx as never);
      const text = replies[0]!.text;
      expect(text).not.toContain("DATABASE_URL");
      expect(text).not.toContain("TELEGRAM_BOT_TOKEN");
      expect(text).not.toContain("api/v1");
    });
  });

  describe("handleUnknownCallback", () => {
    it("acknowledges unknown callback data without sending a message", async () => {
      const { ctx, replies } = makeCallbackCtx("some_unknown_action_xyz");
      ctx.callbackQuery.data = "some_unknown_action_xyz";
      await handleUnknownCallback(ctx as never);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledOnce();
      // Should NOT reply with any visible message
      expect(replies).toHaveLength(0);
    });

    it("does not crash on stale unknown callback", async () => {
      const { ctx } = makeCallbackCtx("old_callback");
      ctx.answerCallbackQuery.mockRejectedValue(new Error("too old"));
      await expect(handleUnknownCallback(ctx as never)).resolves.toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security — no cross-user data leakage
// ─────────────────────────────────────────────────────────────────────────────
describe("Security — user isolation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("/wallet — only queries the wallet of the resolved userId, never raw telegramUserId", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "safe-user-id" });
    (prisma.wallet.findUnique as Mock).mockResolvedValue({ balanceETB: 0 });
    const { ctx } = makeCtx("777888999");
    await handleWallet(ctx as never);

    const walletCall = (prisma.wallet.findUnique as Mock).mock.calls[0] as [unknown];
    const query = walletCall[0] as Record<string, unknown>;
    expect(JSON.stringify(query["where"])).toContain("safe-user-id");
    expect(JSON.stringify(query["where"])).not.toContain("777888999");
  });

  it("/campaigns — only queries campaigns of the resolved userId", async () => {
    (prisma.telegramIdentity.findUnique as Mock).mockResolvedValue({ userId: "safe-user-id-2" });
    (prisma.campaign.findMany as Mock).mockResolvedValue([]);
    const { ctx } = makeCtx("111222333");
    await handleCampaigns(ctx as never);

    const campaignCall = (prisma.campaign.findMany as Mock).mock.calls[0] as [unknown];
    const query = campaignCall[0] as Record<string, unknown>;
    expect(JSON.stringify(query["where"])).toContain("safe-user-id-2");
    expect(JSON.stringify(query["where"])).not.toContain("111222333");
  });
});
