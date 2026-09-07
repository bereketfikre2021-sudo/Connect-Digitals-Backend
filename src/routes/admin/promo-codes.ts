/**
 * Admin promo code routes
 *
 * GET    /api/v1/admin/promo-codes        — list all codes
 * POST   /api/v1/admin/promo-codes        — create a code
 * PATCH  /api/v1/admin/promo-codes/:id    — update / deactivate
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";

// Prisma client cast — promoCode model added in migration 20260907000002
// but client not yet regenerated in CI; will be available after `prisma generate`
const db = prisma as unknown as {
  promoCode: {
    findMany:   (a: unknown) => Promise<unknown[]>;
    findUnique: (a: unknown) => Promise<unknown | null>;
    create:     (a: unknown) => Promise<unknown>;
    update:     (a: unknown) => Promise<unknown>;
  };
};

export const adminPromoCodesRouter: IRouter = Router();
adminPromoCodesRouter.use(requireAdmin);

adminPromoCodesRouter.get("/", async (_req, res, next) => {
  try {
    const codes = await db.promoCode.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, code: true, discountPercent: true, maxUses: true,
        usedCount: true, minOrderETB: true, expiresAt: true, isActive: true, createdAt: true,
      },
    });
    res.json({ success: true, data: codes });
  } catch (err) { next(err); }
});

const codeSchema = z.object({
  code:            z.string().min(3).max(30).toUpperCase().trim(),
  discountPercent: z.number().int().min(1).max(100),
  maxUses:         z.number().int().positive().optional().nullable(),
  minOrderETB:     z.number().int().min(0).optional().default(0),
  expiresAt:       z.string().datetime().optional().nullable(),
  isActive:        z.boolean().optional(),
});

adminPromoCodesRouter.post(
  "/",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = codeSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid promo code data", parsed.error.flatten());

      const existing = await db.promoCode.findUnique({ where: { code: parsed.data.code } });
      if (existing) throw new AppError(409, "CODE_EXISTS", "A promo code with this code already exists");

      const code = await db.promoCode.create({
        data: {
          code:            parsed.data.code,
          discountPercent: parsed.data.discountPercent,
          maxUses:         parsed.data.maxUses ?? null,
          minOrderETB:     parsed.data.minOrderETB,
          expiresAt:       parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
          isActive:        true,
        },
      });
      res.status(201).json({ success: true, data: code });
    } catch (err) { next(err); }
  }
);

adminPromoCodesRouter.patch(
  "/:id",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const updates = codeSchema.partial().safeParse(req.body);
      if (!updates.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid update", updates.error.flatten());

      const existing = await db.promoCode.findUnique({ where: { id: req.params["id"] as string } });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Promo code not found");

      const updated = await db.promoCode.update({
        where: { id: req.params["id"] as string },
        data: {
          ...(updates.data.code            !== undefined ? { code:            updates.data.code }            : {}),
          ...(updates.data.discountPercent !== undefined ? { discountPercent: updates.data.discountPercent } : {}),
          ...(updates.data.maxUses         !== undefined ? { maxUses:         updates.data.maxUses }         : {}),
          ...(updates.data.minOrderETB     !== undefined ? { minOrderETB:     updates.data.minOrderETB }     : {}),
          ...(updates.data.isActive        !== undefined ? { isActive:        updates.data.isActive }        : {}),
          ...(updates.data.expiresAt       !== undefined ? { expiresAt: updates.data.expiresAt ? new Date(updates.data.expiresAt) : null } : {}),
        },
      });
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }
);
