/**
 * Customer auth routes
 *
 * POST /api/v1/auth/telegram  — validates initData, upserts Supabase Auth user + app User,
 *                               returns a Supabase session
 * GET  /api/v1/auth/me        — returns current customer profile (requires auth)
 */

import { Router, type IRouter } from "express";
import { validateInitData, TelegramAuthError } from "../lib/telegram-auth.js";
import { upsertCustomer } from "../services/customer.service.js";
import { requireCustomer } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { getServiceClient } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

export const authRouter: IRouter = Router();

// ─── DEVELOPMENT ONLY ────────────────────────────────────────────────────────
// This endpoint does not exist in production (NODE_ENV !== "development").
// It mints a real Supabase session for a fixed mock user so the Mini App
// can be tested directly in a browser without Telegram.
if (env.NODE_ENV === "development") {
  authRouter.post("/dev-login", async (_req, res, next) => {
    try {
      const { DEV_MOCK_TELEGRAM_USER, DEV_MOCK_AUTH_DATE } = await import("../lib/dev-auth.js");

      const { userId, supabaseUserId, session, isNew } = await upsertCustomer(
        DEV_MOCK_TELEGRAM_USER,
        DEV_MOCK_AUTH_DATE
      );

      logger.warn({ userId, supabaseUserId, isNew }, "⚠️  DEV mock login used — not for production");

      res.json({
        success: true,
        data: {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresIn: session.expires_in,
          isNew,
          isDev: true,
        },
      });
    } catch (err) {
      next(err);
    }
  });
}

/**
 * POST /api/v1/auth/telegram
 * Body: { initData: string }
 *
 * 1. Validates Telegram initData server-side (bot token never leaves the server).
 * 2. Upserts the Supabase Auth user and the app User + TelegramIdentity records.
 * 3. Returns a Supabase session (access_token + refresh_token).
 *    The client uses access_token as Bearer for all subsequent requests.
 */
authRouter.post("/telegram", authLimiter, async (req, res, next) => {
  try {
    const { initData } = req.body as { initData?: string };

    if (!initData || typeof initData !== "string") {
      throw new AppError(400, "MISSING_INIT_DATA", "initData is required");
    }

    // Server-side Telegram validation — bot token never leaves this handler
    const parsed = validateInitData(initData, env.TELEGRAM_BOT_TOKEN);

    // Upsert app-level User + TelegramIdentity + Wallet records,
    // and ensure there is a corresponding Supabase Auth user
    const { userId, supabaseUserId, session, isNew } = await upsertCustomer(
      parsed.user,
      new Date(parsed.auth_date * 1000)
    );

    logger.info({ userId, supabaseUserId, isNew }, "Customer authenticated via Telegram");

    res.json({
      success: true,
      data: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresIn: session.expires_in,
        isNew,
      },
    });
  } catch (err) {
    if (err instanceof TelegramAuthError) {
      next(new AppError(401, err.code, err.message));
      return;
    }
    next(err);
  }
});

/**
 * POST /api/v1/auth/refresh
 * Body: { refreshToken: string }
 *
 * Refreshes the Supabase session using the refresh token.
 * The client calls this when the access token expires.
 */
authRouter.post("/refresh", authLimiter, async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) throw new AppError(400, "MISSING_REFRESH_TOKEN", "refreshToken is required");

    const supabase = getServiceClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data.session) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Invalid or expired refresh token");
    }

    res.json({
      success: true,
      data: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/me
 * Returns the authenticated customer's profile.
 */
authRouter.get("/me", requireCustomer, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.customer!.sub },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        status: true,
        createdAt: true,
        telegramIdentity: {
          select: {
            telegramUserId: true,
            username: true,
            photoUrl: true,
            isPremium: true,
            lastSeenAt: true,
          },
        },
        wallet: {
          select: { balanceETB: true },
        },
      },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new AppError(401, "ACCOUNT_INACTIVE", "Account is not active");
    }

    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
});


