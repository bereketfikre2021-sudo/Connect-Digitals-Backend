/**
 * Wallet routes — authenticated customer endpoints
 *
 * GET  /api/v1/wallet               — balance
 * GET  /api/v1/wallet/transactions  — transaction history (paginated)
 * POST /api/v1/wallet/pay           — pay for an order using wallet balance
 */

import { Router, type IRouter } from "express";
import { requireCustomer } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { prisma } from "../lib/prisma.js";
import { debitWalletForOrder } from "../services/wallet.service.js";
import { z } from "zod";

export const walletRouter: IRouter = Router();
walletRouter.use(requireCustomer);

// GET /api/v1/wallet
walletRouter.get("/", async (req, res, next) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.customer!.sub },
      select: { id: true, balanceETB: true, updatedAt: true },
    });
    if (!wallet) throw new AppError(404, "WALLET_NOT_FOUND", "Wallet not found");
    res.json({ success: true, data: wallet });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/wallet/transactions
walletRouter.get("/transactions", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));
    const skip = (page - 1) * pageSize;

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.customer!.sub },
      select: { id: true },
    });
    if (!wallet) throw new AppError(404, "WALLET_NOT_FOUND", "Wallet not found");

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip, take: pageSize,
        select: {
          id: true, type: true, amountETB: true,
          balanceBefore: true, balanceAfter: true,
          description: true, reference: true, createdAt: true,
        },
      }),
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    res.json({ success: true, data: { transactions, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/wallet/pay
// Atomically debit wallet and mark order as paid
const paySchema = z.object({
  orderId: z.string().cuid(),
  idempotencyKey: z.string().uuid(),
});

walletRouter.post("/pay", async (req, res, next) => {
  try {
    const parsed = paySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid request", parsed.error.flatten());

    const result = await debitWalletForOrder({
      userId: req.customer!.sub,
      orderId: parsed.data.orderId,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    res.json({ success: true, data: { balanceAfter: result.balanceAfter } });
  } catch (err) {
    next(err);
  }
});


