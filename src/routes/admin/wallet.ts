/**
 * Admin wallet routes
 *
 * GET  /api/v1/admin/wallets                    — list all wallets
 * GET  /api/v1/admin/wallets/:userId            — customer wallet detail
 * POST /api/v1/admin/wallets/:userId/credit      — manual credit (SUPER_ADMIN only)
 * POST /api/v1/admin/payments/:id/approve-deposit — approve deposit payment & credit wallet
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { creditWallet } from "../../services/wallet.service.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";

export const adminWalletRouter: IRouter = Router();
adminWalletRouter.use(requireAdmin);

// GET /api/v1/admin/wallets
adminWalletRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));
    const search = (req.query["search"] as string | undefined)?.trim();

      const where = search
      ? {
          OR: [
            { user: { firstName: { contains: search, mode: "insensitive" as const } } },
            { user: { lastName: { contains: search, mode: "insensitive" as const } } },
            { user: { username: { contains: search, mode: "insensitive" as const } } },
          ],
          deletedAt: null,
        }
      : { deletedAt: null };

    const [wallets, total] = await Promise.all([
      prisma.wallet.findMany({
        where,
        orderBy: { balanceETB: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, balanceETB: true, updatedAt: true,
          user: { select: { id: true, firstName: true, lastName: true, username: true } },
        },
      }),
      prisma.wallet.count({ where }),
    ]);

    res.json({ success: true, data: { wallets, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/wallets/:userId
adminWalletRouter.get("/:userId", async (req, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.params["userId"] as string },
      select: {
        id: true, balanceETB: true, updatedAt: true,
        user: { select: { firstName: true, lastName: true, username: true } },
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true, type: true, amountETB: true,
            balanceBefore: true, balanceAfter: true,
            description: true, createdAt: true,
          },
        },
      },
    });

    if (!wallet) throw new AppError(404, "NOT_FOUND", "Wallet not found");
    res.json({ success: true, data: wallet });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/wallets/:userId/credit — SUPER_ADMIN manual adjustment
const creditSchema = z.object({
  amountETB: z.number().int().positive(),
  description: z.string().min(1).max(200),
  // Requires a synthetic payment ID for idempotency — admin provides a reference
  referenceId: z.string().uuid(),
});

adminWalletRouter.post(
  "/:userId/credit",
  requireRole("SUPER_ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = creditSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid credit data", parsed.error.flatten());

      const userId = req.params["userId"] as string;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new AppError(404, "NOT_FOUND", "User not found");

      const result = await creditWallet({
        userId,
        amountETB: parsed.data.amountETB,
        paymentId: parsed.data.referenceId,
        description: parsed.data.description,
        actorId: req.admin!.sub,
      });

      res.json({ success: true, data: { balanceAfter: result.balanceAfter } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/admin/wallets/deposits/:paymentId/approve
// Approves a deposit Payment (orderId=null) and atomically credits the wallet.
adminWalletRouter.post(
  "/deposits/:paymentId/approve",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const paymentId = req.params["paymentId"] as string;

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true, userId: true, orderId: true,
          amountETB: true, status: true,
          user: { select: { firstName: true, lastName: true } },
        },
      });

      if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
      if (payment.orderId !== null) {
        throw new AppError(409, "NOT_A_DEPOSIT", "This payment is linked to an order — use the order approval endpoint");
      }
      if (payment.status !== "UNDER_REVIEW") {
        throw new AppError(409, "INVALID_STATE", `Payment is already ${payment.status}`);
      }

      // Mark payment as approved
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "APPROVED", reviewedBy: req.admin!.sub, reviewedAt: new Date() },
      });

      // Credit the wallet — creditWallet is idempotent on paymentId
      const result = await creditWallet({
        userId: payment.userId,
        amountETB: payment.amountETB,
        paymentId: payment.id,
        description: "Wallet deposit approved",
        actorId: req.admin!.sub,
      });

      res.json({ success: true, data: { balanceAfter: result.balanceAfter } });
    } catch (err) {
      next(err);
    }
  }
);


