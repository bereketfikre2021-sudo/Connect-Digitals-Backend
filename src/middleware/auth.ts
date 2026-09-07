import type { Request, Response, NextFunction } from "express";
import { getUserFromToken } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "./error.js";

/**
 * Customer auth middleware.
 *
 * Validates the Supabase access token in the Authorization: Bearer header.
 * Looks up the app User record via the supabaseUserId column and attaches
 * it to req.customer.
 *
 * The Supabase token was issued by the server after Telegram initData
 * validation — the client never bypasses that step.
 */
export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    return;
  }
  const token = header.slice(7);

  // Async validation — wrapped to keep the middleware signature synchronous-looking
  getUserFromToken(token)
    .then(async (supabaseUser) => {
      // Resolve app User from the Supabase Auth UUID
      const user = await prisma.user.findUnique({
        where: { supabaseUserId: supabaseUser.id },
        select: { id: true, status: true },
      });

      if (!user || user.status !== "ACTIVE") {
        next(new AppError(401, "ACCOUNT_INACTIVE", "Account not found or inactive"));
        return;
      }

      req.customer = {
        sub: user.id,
        supabaseUserId: supabaseUser.id,
      };
      next();
    })
    .catch(() => {
      next(new AppError(401, "INVALID_TOKEN", "Invalid or expired token"));
    });
}


