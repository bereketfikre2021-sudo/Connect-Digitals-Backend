/**
 * Wallet service — all balance mutations.
 *
 * Every operation uses SELECT ... FOR UPDATE inside a serializable
 * transaction to prevent race conditions, double-credits, and overdrafts.
 *
 * Wallet balances are stored as integer ETB cents.
 * The frontend NEVER supplies a balance; it only reads one.
 */

import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";
import { writeAuditLog } from "./audit.service.js";
import { sendNotification } from "./notification.service.js";
import type { AuditActorType } from "../shared/index.js";

// ─── Credit wallet after payment approval ────────────────────────────────────

export interface CreditWalletInput {
  userId: string;
  amountETB: number;
  paymentId: string;
  description?: string;
  actorId: string;
}

export async function creditWallet(input: CreditWalletInput) {
  // Idempotency: a payment must never credit a wallet twice
  const alreadyCredited = await prisma.walletTransaction.findUnique({
    where: { paymentId: input.paymentId },
  });
  if (alreadyCredited) {
    throw new AppError(409, "ALREADY_CREDITED", "This payment has already credited the wallet");
  }

  // Use a transaction with row-level lock to prevent race conditions
  const result = await prisma.$transaction(
    async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      // Lock the wallet row for update
      const wallet = await tx.$queryRaw<Array<{ id: string; balance_etb: number }>>`
        SELECT id, "balanceETB" as balance_etb
        FROM "Wallet"
        WHERE "userId" = ${input.userId}
        FOR UPDATE
      `;

      if (!wallet[0]) throw new AppError(404, "WALLET_NOT_FOUND", "Wallet not found");

      const { id: walletId, balance_etb: balanceBefore } = wallet[0];
      const balanceAfter = balanceBefore + input.amountETB;

      await tx.wallet.update({
        where: { id: walletId },
        data: { balanceETB: balanceAfter },
      });

      const txRecord = await tx.walletTransaction.create({
        data: {
          walletId,
          userId: input.userId,
          type: "DEPOSIT",
          amountETB: input.amountETB,
          balanceBefore,
          balanceAfter,
          description: input.description ?? "Wallet deposit",
          paymentId: input.paymentId,
        },
      });

      return { walletId, balanceBefore, balanceAfter, txRecord };
    },
    { isolationLevel: "Serializable" }
  );

  await writeAuditLog({
    actorId: input.actorId,
    actorType: "ADMIN" as AuditActorType,
    action: "WALLET_CREDITED",
    entityType: "Wallet",
    entityId: result.walletId,
    before: { balanceETB: result.balanceBefore },
    after: { balanceETB: result.balanceAfter },
  });

  await sendNotification(input.userId, "WALLET_CREDITED", {
    amount: (input.amountETB / 100).toFixed(2),
    balance: (result.balanceAfter / 100).toFixed(2),
  });

  return result;
}

// ─── Debit wallet to pay for an order ────────────────────────────────────────

export interface DebitWalletForOrderInput {
  userId: string;
  orderId: string;
  idempotencyKey: string;
}

export async function debitWalletForOrder(input: DebitWalletForOrderInput) {
  // Load order and verify ownership + status (outside transaction — read-only, safe)
  const order = await prisma.order.findFirst({
    where: {
      id: input.orderId,
      userId: input.userId,
      orderStatus: { in: ["PENDING_PAYMENT", "PAYMENT_REJECTED"] },
    },
    select: {
      id: true, orderNumber: true, totalAmountETB: true,
      service: { select: { name: true, fulfillmentType: true } },
      package: { select: { deliveryDaysMin: true, deliveryDaysMax: true } },
    },
  });

  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order not found or not eligible for wallet payment");

  const result = await prisma.$transaction(
    async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      // Lock the wallet row first to prevent race conditions
      const wallet = await tx.$queryRaw<Array<{ id: string; balance_etb: number }>>`
        SELECT id, "balanceETB" as balance_etb
        FROM "Wallet"
        WHERE "userId" = ${input.userId}
        FOR UPDATE
      `;

      if (!wallet[0]) throw new AppError(404, "WALLET_NOT_FOUND", "Wallet not found");

      // Idempotency check INSIDE the transaction (after acquiring the row lock)
      // to prevent TOCTOU race: two concurrent requests acquiring the lock
      // sequentially — the second will find the existing transaction and abort.
      const existingTx = await tx.walletTransaction.findFirst({
        where: { userId: input.userId, orderId: input.orderId, type: "ORDER_PAYMENT" },
      });
      if (existingTx) {
        throw new AppError(409, "ALREADY_PAID", "This order has already been paid from wallet");
      }

      const { id: walletId, balance_etb: balanceBefore } = wallet[0];

      if (balanceBefore < order.totalAmountETB) {
        throw new AppError(
          402,
          "INSUFFICIENT_BALANCE",
          `Insufficient wallet balance. Required: ${(order.totalAmountETB / 100).toFixed(2)} ETB, Available: ${(balanceBefore / 100).toFixed(2)} ETB`
        );
      }

      const balanceAfter = balanceBefore - order.totalAmountETB;

      await tx.wallet.update({
        where: { id: walletId },
        data: { balanceETB: balanceAfter },
      });

      const txRecord = await tx.walletTransaction.create({
        data: {
          walletId,
          userId: input.userId,
          type: "ORDER_PAYMENT",
          amountETB: order.totalAmountETB,
          balanceBefore,
          balanceAfter,
          description: `Payment for order ${order.orderNumber}`,
          orderId: input.orderId,
        },
      });

      // Advance order to PAYMENT_APPROVED — wallet payment is immediate
      await tx.order.update({
        where: { id: input.orderId },
        data: {
          orderStatus: "PAYMENT_APPROVED",
          paymentStatus: "APPROVED",
        },
      });

      return { walletId, balanceBefore, balanceAfter, txRecord };
    },
    { isolationLevel: "Serializable" }
  );

  await writeAuditLog({
    actorId: input.userId,
    actorType: "CUSTOMER" as AuditActorType,
    action: "WALLET_DEBITED",
    entityType: "Wallet",
    entityId: result.walletId,
    before: { balanceETB: result.balanceBefore },
    after: { balanceETB: result.balanceAfter },
    orderId: input.orderId,
  });

  // Trigger fulfillment using the service's configured fulfillment type.
  // MANUAL is the default; future services may use META_ADS, GOOGLE_ADS, TIKTOK_ADS.
  const { createFulfillmentTask } = await import("./fulfillment.service.js");
  await createFulfillmentTask(input.orderId, order.service.fulfillmentType as never);

  await sendNotification(input.userId, "PAYMENT_APPROVED", {
    orderNumber: order.orderNumber,
    amount: (order.totalAmountETB / 100).toFixed(2),
  });

  return result;
}

// ─── Refund to wallet ────────────────────────────────────────────────────────

export async function refundToWallet(
  userId: string,
  amountETB: number,
  orderId: string,
  adminId: string
) {
  const result = await prisma.$transaction(
    async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      const wallet = await tx.$queryRaw<Array<{ id: string; balance_etb: number }>>`
        SELECT id, "balanceETB" as balance_etb
        FROM "Wallet"
        WHERE "userId" = ${userId}
        FOR UPDATE
      `;

      if (!wallet[0]) throw new AppError(404, "WALLET_NOT_FOUND", "Wallet not found");
      const { id: walletId, balance_etb: balanceBefore } = wallet[0];
      const balanceAfter = balanceBefore + amountETB;

      await tx.wallet.update({ where: { id: walletId }, data: { balanceETB: balanceAfter } });

      const txRecord = await tx.walletTransaction.create({
        data: {
          walletId,
          userId,
          type: "REFUND",
          amountETB,
          balanceBefore,
          balanceAfter,
          description: "Refund",
          orderId,
        },
      });

      return { walletId, balanceBefore, balanceAfter, txRecord };
    },
    { isolationLevel: "Serializable" }
  );

  await writeAuditLog({
    actorId: adminId,
    actorType: "ADMIN" as AuditActorType,
    action: "WALLET_CREDITED",
    entityType: "Wallet",
    entityId: result.walletId,
    before: { balanceETB: result.balanceBefore },
    after: { balanceETB: result.balanceAfter },
    orderId,
  });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true },
  });

  await sendNotification(userId, "REFUND_ISSUED", {
    amount: (amountETB / 100).toFixed(2),
    orderNumber: order?.orderNumber ?? "",
  });

  return result;
}



