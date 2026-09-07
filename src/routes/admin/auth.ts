/**
 * Admin auth routes
 *
 * POST /api/v1/admin/auth/login    — email + password → Supabase session
 * POST /api/v1/admin/auth/refresh  — refresh Supabase session
 * POST /api/v1/admin/auth/logout   — invalidate Supabase session
 * GET  /api/v1/admin/auth/me       — current admin profile + role
 */

import { Router, type IRouter } from "express";
import { getServiceClient } from "../../lib/supabase.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error.js";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { authLimiter } from "../../middleware/rateLimit.js";
import { writeAuditLog } from "../../services/audit.service.js";
import { z } from "zod";

export const adminAuthRouter: IRouter = Router();

const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

/**
 * POST /api/v1/admin/auth/login
 *
 * Authenticates via Supabase Auth (email + password).
 * After Supabase validates the credentials, the AdminUser table is checked
 * to confirm the account is an active admin — Supabase Auth alone is not
 * sufficient to gain admin access.
 */
adminAuthRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid credentials");

    // Step 1 — authenticate with Supabase Auth
    const supabase = getServiceClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (authError || !authData.session) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    // Step 2 — verify active AdminUser record (authoritative role check)
    const adminUser = await prisma.adminUser.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });

    if (!adminUser || !adminUser.isActive) {
      // Valid Supabase credentials but not a registered admin — sign out the session
      await supabase.auth.signOut();
      throw new AppError(403, "NOT_AN_ADMIN", "This account does not have admin access");
    }

    await writeAuditLog({
      actorId: adminUser.id,
      actorType: "ADMIN" as never,
      action: "ADMIN_LOGIN",
      entityType: "AdminUser",
      entityId: adminUser.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.json({
      success: true,
      data: {
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        expiresIn: authData.session.expires_in,
        admin: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: adminUser.role,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/auth/refresh
 * Body: { refreshToken: string }
 */
adminAuthRouter.post("/refresh", authLimiter, async (req, res, next) => {
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
 * POST /api/v1/admin/auth/logout
 */
adminAuthRouter.post("/logout", requireAdmin, async (req, res, next) => {
  try {
    // Invalidate the Supabase session server-side
    const supabase = getServiceClient();
    await supabase.auth.admin.signOut(req.admin!.supabaseUserId);

    await writeAuditLog({
      actorId: req.admin!.sub,
      actorType: "ADMIN" as never,
      action: "ADMIN_LOGOUT",
      entityType: "AdminUser",
      entityId: req.admin!.sub,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/admin/auth/me
 */
adminAuthRouter.get("/me", requireAdmin, async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: req.admin!.sub },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });
    if (!admin || !admin.isActive) throw new AppError(401, "UNAUTHORIZED", "Account inactive");
    res.json({ success: true, data: admin });
  } catch (err) {
    next(err);
  }
});


