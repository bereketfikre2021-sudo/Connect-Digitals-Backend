/**
 * Admin user management routes (SUPER_ADMIN only)
 *
 * GET    /api/v1/admin/admin-users         — list all admin users
 * POST   /api/v1/admin/admin-users         — create a new admin user
 * PATCH  /api/v1/admin/admin-users/:id     — update role / name
 * DELETE /api/v1/admin/admin-users/:id     — deactivate (soft)
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { getServiceClient } from "../../lib/supabase.js";
import { writeAuditLog } from "../../services/audit.service.js";
import { z } from "zod";

export const adminUsersRouter: IRouter = Router();
adminUsersRouter.use(requireAdmin);
adminUsersRouter.use(requireRole("SUPER_ADMIN" as never));

// ── List ─────────────────────────────────────────────────────────────────────
adminUsersRouter.get("/", async (_req, res, next) => {
  try {
    const admins = await prisma.adminUser.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, createdAt: true,
      },
    });
    res.json({ success: true, data: admins });
  } catch (err) { next(err); }
});

// ── Create ────────────────────────────────────────────────────────────────────
const createSchema = z.object({
  email:     z.string().email().toLowerCase().trim(),
  password:  z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1).max(100).trim(),
  lastName:  z.string().min(1).max(100).trim(),
  role:      z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]),
});

adminUsersRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid admin user data", parsed.error.flatten());

    // Check uniqueness
    const existing = await prisma.adminUser.findUnique({ where: { email: parsed.data.email } });
    if (existing) throw new AppError(409, "EMAIL_TAKEN", "An admin with this email already exists");

    // Create Supabase Auth user
    const supabase = getServiceClient();
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
    });
    if (authError || !authData.user) {
      throw new AppError(502, "AUTH_CREATE_FAILED", authError?.message ?? "Failed to create auth user");
    }

    const admin = await prisma.adminUser.create({
      data: {
        email:     parsed.data.email,
        firstName: parsed.data.firstName,
        lastName:  parsed.data.lastName,
        role:      parsed.data.role as never,
        isActive:  true,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true },
    });

    await writeAuditLog({
      actorId:    req.admin!.sub,
      actorType:  "ADMIN" as never,
      action:     "ADMIN_USER_CREATED",
      entityType: "AdminUser",
      entityId:   admin.id,
      after:      { email: admin.email, role: admin.role },
    });

    res.status(201).json({ success: true, data: admin });
  } catch (err) { next(err); }
});

// ── Update ────────────────────────────────────────────────────────────────────
const updateSchema = z.object({
  firstName: z.string().min(1).max(100).trim().optional(),
  lastName:  z.string().min(1).max(100).trim().optional(),
  role:      z.enum(["SUPER_ADMIN", "ADMIN", "OPERATOR"]).optional(),
  isActive:  z.boolean().optional(),
});

adminUsersRouter.patch("/:id", async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid update data", parsed.error.flatten());

    const target = await prisma.adminUser.findUnique({ where: { id: req.params["id"] as string } });
    if (!target) throw new AppError(404, "NOT_FOUND", "Admin user not found");

    // Prevent deactivating yourself
    if (parsed.data.isActive === false && target.id === req.admin!.sub) {
      throw new AppError(409, "SELF_DEACTIVATION", "You cannot deactivate your own account");
    }

    const updated = await prisma.adminUser.update({
      where: { id: target.id },
      data: parsed.data as never,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });

    await writeAuditLog({
      actorId:    req.admin!.sub,
      actorType:  "ADMIN" as never,
      action:     "ADMIN_USER_UPDATED",
      entityType: "AdminUser",
      entityId:   target.id,
      before:     { role: target.role, isActive: target.isActive },
      after:      parsed.data,
    });

    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

// ── Deactivate ────────────────────────────────────────────────────────────────
adminUsersRouter.delete("/:id", async (req, res, next) => {
  try {
    const target = await prisma.adminUser.findUnique({ where: { id: req.params["id"] as string } });
    if (!target) throw new AppError(404, "NOT_FOUND", "Admin user not found");
    if (target.id === req.admin!.sub) throw new AppError(409, "SELF_DEACTIVATION", "Cannot deactivate yourself");

    await prisma.adminUser.update({ where: { id: target.id }, data: { isActive: false } });

    await writeAuditLog({
      actorId:    req.admin!.sub,
      actorType:  "ADMIN" as never,
      action:     "ADMIN_USER_DEACTIVATED",
      entityType: "AdminUser",
      entityId:   target.id,
      before:     { isActive: true },
      after:      { isActive: false },
    });

    res.json({ success: true, data: { deactivated: true } });
  } catch (err) { next(err); }
});
