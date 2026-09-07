/**
 * Payment service — submission, approval, rejection.
 *
 * All financial state changes happen inside database transactions.
 * The API layer never receives prices or balances from the client.
 */

import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";
import { writeAuditLog } from "./audit.service.js";
import { sendNotification } from "./notification.service.js";
import { createFulfillmentTask } from "./fulfillment.service.js";
import type { AuditActorType } from "../shared/index.js";

// ─── Submit payment ──────────────────────────────────────────────────────────

export interface SubmitPaymentInput {
  userId: string;
  orderId?: string | null;  // null/undefined for wallet deposits
  paymentMethodId: string;
  amountETB: number;
  reference: string;
  screenshotUrl?: string;
  screenshotKey?: string;
  idempotencyKey: string;
  ipAddress?: string;
}

export async function submitPayment(input: SubmitPaymentInput) {
  // Idempotency check — return existing if already submitted
  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return existing;

  // Verify payment method exists and is active
  const method = await prisma.paymentMethod.findFirst({
    where: { id: input.paymentMethodId, isActive: true },
  });
  if (!method) throw new AppError(404, "PAYMENT_METHOD_NOT_FOUND", "Payment method not found");

  // ── DEPOSIT path (no orderId) ─────────────────────────────────────────────
  // For wallet deposits the amount comes from the client (no order to look up).
  // MIN_DEPOSIT_AMOUNT is enforced by the route schema before reaching here.
  if (!input.orderId) {
    if (input.amountETB <= 0) {
      throw new AppError(400, "INVALID_AMOUNT", "Deposit amount must be positive");
    }
    const depositPayment = await prisma.payment.create({
      data: {
        userId:          input.userId,
        orderId:         null,
        paymentMethodId: input.paymentMethodId,
        amountETB:       input.amountETB,
        reference:       input.reference,
        screenshotUrl:   input.screenshotUrl,
        screenshotKey:   input.screenshotKey,
        status:          "UNDER_REVIEW",
        idempotencyKey:  input.idempotencyKey,
      },
    });

    await writeAuditLog({
      actorId:    input.userId,
      actorType:  "CUSTOMER" as AuditActorType,
      action:     "PAYMENT_SUBMITTED",
      entityType: "Payment",
      entityId:   depositPayment.id,
      after:      { paymentId: depositPayment.id, amountETB: input.amountETB, isDeposit: true },
      ipAddress:  input.ipAddress,
    });

    await sendNotification(input.userId, "PAYMENT_SUBMITTED", {
      orderNumber: "Wallet Deposit",
      amount:      (input.amountETB / 100).toFixed(2),
      reference:   input.reference,
    });

    return depositPayment;
  }

  // ── ORDER PAYMENT path ────────────────────────────────────────────────────
  // Verify the order belongs to this customer and is in the right state
  const order = await prisma.order.findFirst({
    where: {
      id: input.orderId,
      userId: input.userId,
      orderStatus: { in: ["PENDING_PAYMENT", "PAYMENT_REJECTED"] },
    },
    include: {
      service: { select: { name: true } },
      package: { select: { name: true, priceETB: true, deliveryDaysMin: true, deliveryDaysMax: true } },
    },
  });

  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found or not eligible for payment");
  }

  // Authoritative amount from DB — client-supplied amountETB is ignored
  const authorativeAmountETB = order.totalAmountETB;

  let payment;
  try {
    payment = await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      const newPayment = await tx.payment.create({
        data: {
          userId:          input.userId,
          orderId:         input.orderId,
          paymentMethodId: input.paymentMethodId,
          amountETB:       authorativeAmountETB,
          reference:       input.reference,
          screenshotUrl:   input.screenshotUrl,
          screenshotKey:   input.screenshotKey,
          status:          "UNDER_REVIEW",
          idempotencyKey:  input.idempotencyKey,
        },
      });

      await tx.order.update({
        where: { id: input.orderId! },
        data: {
          orderStatus:  "PAYMENT_SUBMITTED",
          paymentStatus: "UNDER_REVIEW",
        },
      });

      return newPayment;
    });
  } catch (err: unknown) {
    // Prisma unique constraint on idempotencyKey — concurrent duplicate submission
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const dup = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (dup) return dup;
    }
    throw err;
  }

  await writeAuditLog({
    actorId: input.userId,
    actorType: "CUSTOMER" as AuditActorType,
    action: "PAYMENT_SUBMITTED",
    entityType: "Payment",
    entityId: payment.id,
    after: { paymentId: payment.id, orderId: input.orderId, amountETB: authorativeAmountETB },
    orderId: input.orderId ?? undefined,
    ipAddress: input.ipAddress,
  });

  // Notify customer
  await sendNotification(input.userId, "PAYMENT_SUBMITTED", {
    orderNumber: order.orderNumber,
    amount: (authorativeAmountETB / 100).toFixed(2),
    reference: input.reference,
  });

  return payment;
}

// ─── Approve payment ─────────────────────────────────────────────────────────

export async function approvePayment(
  paymentId: string,
  adminUserId: string,
  ipAddress?: string
) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: {
        include: {
          service: { select: { name: true, fulfillmentType: true } },
          package: { select: { name: true, deliveryDaysMin: true, deliveryDaysMax: true } },
        },
      },
    },
  });

  if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
  if (payment.status !== "UNDER_REVIEW") {
    throw new AppError(409, "INVALID_STATE", `Payment is already ${payment.status}`);
  }
  if (!payment.order) throw new AppError(400, "NO_ORDER", "Payment has no associated order");

  // Check for duplicate approval
  const alreadyApproved = await prisma.payment.findFirst({
    where: { orderId: payment.orderId!, status: "APPROVED" },
  });
  if (alreadyApproved) {
    throw new AppError(409, "ALREADY_APPROVED", "An approved payment already exists for this order");
  }

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "APPROVED",
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
      },
    });

    await tx.order.update({
      where: { id: payment.orderId! },
      data: {
        orderStatus: "PAYMENT_APPROVED",
        paymentStatus: "APPROVED",
      },
    });
  });

  await writeAuditLog({
    actorId: adminUserId,
    actorType: "ADMIN" as AuditActorType,
    action: "PAYMENT_APPROVED",
    entityType: "Payment",
    entityId: paymentId,
    before: { status: "UNDER_REVIEW" },
    after: { status: "APPROVED" },
    orderId: payment.orderId ?? undefined,
    ipAddress,
  });

  // Create fulfillment task using the service's configured fulfillment type.
  // MANUAL is the default; future services may use META_ADS, GOOGLE_ADS, TIKTOK_ADS.
  await createFulfillmentTask(payment.orderId!, payment.order.service.fulfillmentType as never);

  // Notify customer
  await sendNotification(payment.userId, "PAYMENT_APPROVED", {
    orderNumber: payment.order.orderNumber,
    amount: (payment.amountETB / 100).toFixed(2),
  });

  await sendNotification(payment.userId, "ORDER_PROCESSING", {
    orderNumber: payment.order.orderNumber,
    serviceName: payment.order.service.name,
  });

  return { success: true };
}

// ─── Reject payment ──────────────────────────────────────────────────────────

export async function rejectPayment(
  paymentId: string,
  adminUserId: string,
  rejectionReason: string,
  ipAddress?: string
) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { orderNumber: true, orderStatus: true } } },
  });

  if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
  if (payment.status !== "UNDER_REVIEW") {
    throw new AppError(409, "INVALID_STATE", `Payment is already ${payment.status}`);
  }

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "REJECTED",
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        rejectionReason,
      },
    });

    await tx.order.update({
      where: { id: payment.orderId! },
      data: {
        orderStatus: "PAYMENT_REJECTED",
        paymentStatus: "REJECTED",
      },
    });
  });

  await writeAuditLog({
    actorId: adminUserId,
    actorType: "ADMIN" as AuditActorType,
    action: "PAYMENT_REJECTED",
    entityType: "Payment",
    entityId: paymentId,
    before: { status: "UNDER_REVIEW" },
    after: { status: "REJECTED", rejectionReason },
    orderId: payment.orderId ?? undefined,
    ipAddress,
  });

  await sendNotification(payment.userId, "PAYMENT_REJECTED", {
    orderNumber: payment.order?.orderNumber ?? "",
    reason: rejectionReason,
  });

  return { success: true };
}



