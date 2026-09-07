import type { Request, Response, NextFunction } from "express";
import { getUserFromToken } from "../lib/supabase.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "./error.js";
import type { AdminRole } from "../shared/index.js";

// Augment Express Request with admin identity
declare global {
  namespace Express {
    interface Request {
      admin?: {
        sub: string;        // AdminUser.id (app table — authoritative role source)
        supabaseUserId: string;
        role: string;
      };
    }
  }
}

/**
 * Admin auth middleware.
 *
 * 1. Validates the Supabase access token.
 * 2. Looks up the AdminUser record by email to get the role.
 *    The AdminUser table is the authoritative role source — NOT user_metadata —
 *    so a user cannot escalate privileges by editing their own Supabase metadata.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new AppError(401, "UNAUTHORIZED", "Admin authentication required"));
    return;
  }
  const token = header.slice(7);

  getUserFromToken(token)
    .then(async (supabaseUser) => {
      if (!supabaseUser.email) {
        next(new AppError(401, "UNAUTHORIZED", "Admin account has no email"));
        return;
      }

      // Role is read from the AdminUser table, not from Supabase metadata
      const adminUser = await prisma.adminUser.findUnique({
        where: { email: supabaseUser.email },
        select: { id: true, role: true, isActive: true },
      });

      if (!adminUser || !adminUser.isActive) {
        next(new AppError(403, "FORBIDDEN", "No active admin account for this user"));
        return;
      }

      req.admin = {
        sub: adminUser.id,
        supabaseUserId: supabaseUser.id,
        role: adminUser.role,
      };
      next();
    })
    .catch(() => {
      next(new AppError(401, "INVALID_TOKEN", "Invalid or expired admin token"));
    });
}

export function requireRole(...roles: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      next(new AppError(401, "UNAUTHORIZED", "Admin authentication required"));
      return;
    }
    if (!roles.includes(req.admin.role as AdminRole)) {
      next(new AppError(403, "FORBIDDEN", `Requires one of: ${roles.join(", ")}`));
      return;
    }
    next();
  };
}


