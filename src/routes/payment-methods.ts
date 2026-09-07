/**
 * Payment methods routes — public, no auth required
 *
 * GET /api/v1/payment-methods   — all active payment methods
 * GET /api/v1/payment-methods/:id — single method
 *
 * Account numbers and instructions come from the DB, never hardcoded.
 */

import { Router, type IRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";

export const paymentMethodsRouter: IRouter = Router();

paymentMethodsRouter.get("/", async (_req, res, next) => {
  try {
    const methods = await prisma.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        accountName: true,
        accountNumber: true,
        bankName: true,
        instructions: true,
        sortOrder: true,
      },
    });
    res.json({ success: true, data: methods });
  } catch (err) {
    next(err);
  }
});

paymentMethodsRouter.get("/:id", async (req, res, next) => {
  try {
    const method = await prisma.paymentMethod.findFirst({
      where: { id: req.params["id"], isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        accountName: true,
        accountNumber: true,
        bankName: true,
        instructions: true,
      },
    });
    if (!method) throw new AppError(404, "NOT_FOUND", "Payment method not found");
    res.json({ success: true, data: method });
  } catch (err) {
    next(err);
  }
});


