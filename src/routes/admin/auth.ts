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
 * POST /api/v1/admin/auth/forgot-password
 * Body: { email: string }
 *
 * Sends a Supabase password reset email to the given address if it belongs
 * to an active admin. Always responds 200 (no enumeration of valid emails).
 */
adminAuthRouter.post("/forgot-password", authLimiter, async (req, res, next) => {
  try {
    const { email } = req.body as { email?: string };
    if (!email || typeof email !== "string") {
      throw new AppError(400, "MISSING_EMAIL", "Email is required");
    }

    const normalised = email.toLowerCase().trim();

    // Only trigger if this is a known active admin — otherwise silently succeed
    const admin = await prisma.adminUser.findUnique({
      where: { email: normalised },
      select: { isActive: true },
    });

    if (admin?.isActive) {
      const supabase = getServiceClient();
      // redirectTo is where Supabase sends the user after clicking the email link.
      // Set ADMIN_URL env var to your deployed admin URL.
      const redirectTo = `${process.env["ADMIN_URL"] ?? ""}/reset-password`;
      await supabase.auth.admin.generateLink({
        type: "recovery",
        email: normalised,
        options: { redirectTo },
      });
    }

    // Always return 200 — never reveal whether the email exists
    res.json({ success: true, message: "If that email belongs to an admin account, a reset link has been sent." });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/admin/auth/reset-password
 * Body: { accessToken: string, newPassword: string }
 *
 * Sets a new password using the Supabase access token from the reset email link.
 */
adminAuthRouter.post("/reset-password", async (req, res, next) => {
  try {
    const { accessToken, newPassword } = req.body as { accessToken?: string; newPassword?: string };
    if (!accessToken || !newPassword) {
      throw new AppError(400, "MISSING_FIELDS", "accessToken and newPassword are required");
    }
    if (newPassword.length < 8) {
      throw new AppError(400, "PASSWORD_TOO_SHORT", "Password must be at least 8 characters");
    }

    const supabase = getServiceClient();

    // Verify the token belongs to an admin before allowing the reset
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData.user) {
      throw new AppError(401, "INVALID_TOKEN", "Reset link is invalid or has expired");
    }

    const admin = await prisma.adminUser.findUnique({
      where: { email: userData.user.email ?? "" },
      select: { id: true, isActive: true },
    });
    if (!admin?.isActive) {
      throw new AppError(403, "NOT_AN_ADMIN", "This account does not have admin access");
    }

    // Update the password
    const { error: updateErr } = await supabase.auth.admin.updateUserById(userData.user.id, {
      password: newPassword,
    });
    if (updateErr) {
      throw new AppError(500, "RESET_FAILED", "Failed to update password");
    }

    res.json({ success: true, message: "Password updated successfully. You can now log in." });
  } catch (err) {
    next(err);
  }
});
adminAuthRouter.get("/me", requireAdmin, async (req, res, next) => {
  try {
    const admin = await prisma.adminUser.findUnique({
      where: { id: req.admin!.sub },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });
    if (!admin || !admin.isActive) throw new AppError(401, "UNAUTHORIZED", "Account inactive");

    // Also fetch the global brand logo (set by any admin)
    const logoSetting = await prisma.adminUser.findFirst({
      where: { isActive: true, brandLogoUrl: { not: null } },
      select: { brandLogoUrl: true },
      orderBy: { updatedAt: "desc" },
    });

    res.json({ success: true, data: { ...admin, brandLogoUrl: logoSetting?.brandLogoUrl ?? null } });
  } catch (err) {
    next(err);
  }
});


