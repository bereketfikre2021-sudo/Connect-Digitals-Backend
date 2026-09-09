/**
 * Admin orders routes
 *
 * GET /api/v1/admin/orders       — list all orders (searchable, filterable, paginated)
 * GET /api/v1/admin/orders/:id   — full order detail
 */

import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";

export const adminOrdersRouter: IRouter = Router();
adminOrdersRouter.use(requireAdmin);

// GET /api/v1/admin/orders
adminOrdersRouter.get("/", async (req, res, next) => {
  try {
    const search = (req.query["search"] as string | undefined)?.trim();
    const status = req.query["status"] as string | undefined;
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));

    // Build WHERE clause
    const where: Record<string, unknown> = {};
    if (status) where["orderStatus"] = status;
    if (search) {
      where["OR"] = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { user: { firstName: { contains: search, mode: "insensitive" } } },
        { user: { lastName: { contains: search, mode: "insensitive" } } },
        { user: { username: { contains: search, mode: "insensitive" } } },
        { targetUrl: { contains: search, mode: "insensitive" } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          targetUrl: true,
          targetType: true,
          totalAmountETB: true,
          orderStatus: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          createdAt: true,
          completedAt: true,
          user: { select: { id: true, firstName: true, lastName: true, username: true } },
          service: {
            select: {
              name: true,
              platform: { select: { name: true } },
            },
          },
          package: { select: { name: true, quantity: true } },
        },
      }),
      prisma.order.count({ where: where as never }),
    ]);

    res.json({
      success: true,
      data: { orders, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/orders/:id
adminOrdersRouter.get("/:id", async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params["id"] as string },
      include: {
        user: {
          select: {
            id: true, firstName: true, lastName: true, username: true,
            telegramIdentity: { select: { telegramUserId: true } },
          },
        },
        service: { include: { platform: true } },
        package: true,
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, status: true, amountETB: true, reference: true,
            createdAt: true, reviewedAt: true, rejectionReason: true,
            paymentMethod: { select: { name: true } },
          },
        },
        fulfillmentTask: {
          select: {
            id: true, status: true, fulfillmentType: true,
            startedAt: true, completedAt: true, createdAt: true,
            assignee: { select: { firstName: true, lastName: true } },
          },
        },
        campaign: {
          select: { id: true, internalStatus: true, provider: true, startDate: true, endDate: true },
        },
        reports: {
          where: { status: "PUBLISHED" },
          select: { id: true, title: true, publishedAt: true },
        },
      },
    });

    if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/v1/admin/orders/:id/refund — SUPER_ADMIN only ──────────────────
import { requireRole } from "../../middleware/admin-auth.js";
import { refundToWallet } from "../../services/wallet.service.js";
import { writeAuditLog } from "../../services/audit.service.js";
import { z } from "zod";

const refundSchema = z.object({
  reason: z.string().min(5, "Reason must be at least 5 characters").max(500),
});

adminOrdersRouter.post(
  "/:id/refund",
  requireRole("SUPER_ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = refundSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid refund data", parsed.error.flatten());

      const orderId = req.params["id"] as string;

      // Load order — must exist and be in a refundable state
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          totalAmountETB: true,
          orderStatus: true,
          paymentStatus: true,
          payments: {
            where: { status: "APPROVED" },
            select: { id: true, amountETB: true },
            take: 1,
          },
        },
      });

      if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");

      // Only COMPLETED or CANCELLED orders with an APPROVED payment are refundable
      const refundableStatuses = ["COMPLETED", "CANCELLED"];
      if (!refundableStatuses.includes(order.orderStatus)) {
        throw new AppError(
          409,
          "NOT_REFUNDABLE",
          `Order cannot be refunded in status ${order.orderStatus}. Only COMPLETED or CANCELLED orders are eligible.`
        );
      }

      if (order.paymentStatus !== "APPROVED") {
        throw new AppError(409, "PAYMENT_NOT_APPROVED", "No approved payment found for this order");
      }

      // Prevent duplicate refunds — check if a REFUND wallet transaction already exists for this order
      const existingRefund = await prisma.walletTransaction.findFirst({
        where: { orderId, type: "REFUND" },
      });
      if (existingRefund) {
        throw new AppError(409, "ALREADY_REFUNDED", "A refund has already been issued for this order");
      }

      // Authoritative refund amount: the approved payment amount (not the order total,
      // in case the payment was for a different amount due to deposits)
      const approvedPayment = order.payments[0];
      const refundAmountETB = approvedPayment?.amountETB ?? order.totalAmountETB;

      // Issue refund via existing wallet service
      await refundToWallet(order.userId, refundAmountETB, orderId, req.admin!.sub);

      // Update order + payment status to REFUNDED
      await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
        await tx.order.update({
          where: { id: orderId },
          data: { orderStatus: "REFUNDED", paymentStatus: "REFUNDED" },
        });
        if (approvedPayment) {
          await tx.payment.update({
            where: { id: approvedPayment.id },
            data: { status: "REFUNDED" },
          });
        }
      });

      await writeAuditLog({
        actorId: req.admin!.sub,
        actorType: "ADMIN" as never,
        action: "PAYMENT_REFUNDED",
        entityType: "Order",
        entityId: orderId,
        before: { orderStatus: order.orderStatus, paymentStatus: order.paymentStatus },
        after: { orderStatus: "REFUNDED", paymentStatus: "REFUNDED", refundAmountETB, reason: parsed.data.reason },
        orderId,
      });

      res.json({ success: true, data: { refundAmountETB, orderStatus: "REFUNDED" } });
    } catch (err) { next(err); }
  }
);
