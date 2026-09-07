/**
 * Customer promo code validation
 *
 * POST /api/v1/promo-codes/validate — check if a code is valid for a given order amount
 * Returns: { valid, discountPercent, discountETB, finalAmountETB }
 */

import { Router, type IRouter } from "express";
import { requireCustomer } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { prisma } from "../lib/prisma.js";
import { z } from "zod";

export const promoCodesRouter: IRouter = Router();
promoCodesRouter.use(requireCustomer);

// Cast until prisma generate is run after migration
const db = prisma as unknown as {
  promoCode: { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> };
};

const validateSchema = z.object({
  code:        z.string().min(1).toUpperCase().trim(),
  amountETB:   z.number().int().positive(),
});

promoCodesRouter.post("/validate", async (req, res, next) => {
  try {
    const parsed = validateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid request", parsed.error.flatten());

    const promo = await db.promoCode.findUnique({
      where: { code: parsed.data.code },
    });

    if (!promo || !promo["isActive"]) {
      return res.json({ success: true, data: { valid: false, reason: "Invalid or inactive promo code" } });
    }
    if (promo["expiresAt"] && (promo["expiresAt"] as Date) < new Date()) {
      return res.json({ success: true, data: { valid: false, reason: "This promo code has expired" } });
    }
    if (promo["maxUses"] !== null && (promo["usedCount"] as number) >= (promo["maxUses"] as number)) {
      return res.json({ success: true, data: { valid: false, reason: "This promo code has reached its usage limit" } });
    }
    if (parsed.data.amountETB < (promo["minOrderETB"] as number)) {
      return res.json({ success: true, data: {
        valid: false,
        reason: `Minimum order amount for this code is ${((promo["minOrderETB"] as number) / 100).toFixed(2)} ETB`,
      }});
    }

    const discountETB = Math.floor(parsed.data.amountETB * (promo["discountPercent"] as number) / 100);
    const finalAmountETB = Math.max(0, parsed.data.amountETB - discountETB);

    res.json({ success: true, data: {
      valid: true,
      promoId: promo["id"],
      discountPercent: promo["discountPercent"],
      discountETB,
      finalAmountETB,
    }});
  } catch (err) { next(err); }
});
