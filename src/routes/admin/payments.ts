/**
 * Admin payment review routes
 *
 * GET  /api/v1/admin/payments              — list payments (filterable)
 * GET  /api/v1/admin/payments/:id          — payment detail + signed proof URL
 * POST /api/v1/admin/payments/:id/approve  — approve payment
 * POST /api/v1/admin/payments/:id/reject   — reject payment
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { approvePayment, rejectPayment } from "../../services/payment.service.js";
import { getSignedProofUrl } from "../../lib/cloudinary.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";

export const adminPaymentsRouter: IRouter = Router();
adminPaymentsRouter.use(requireAdmin);

// GET /api/v1/admin/payments
adminPaymentsRouter.get("/", async (req, res, next) => {
  try {
    const status = req.query["status"] as string | undefined;
    const search = (req.query["search"] as string | undefined)?.trim();
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));

    const where: Record<string, unknown> = {};
    if (status) where["status"] = status;
    if (search) {
      where["OR"] = [
        { reference: { contains: search, mode: "insensitive" } },
        { order: { orderNumber: { contains: search, mode: "insensitive" } } },
        { user: { firstName: { contains: search, mode: "insensitive" } } },
        { user: { lastName: { contains: search, mode: "insensitive" } } },
        { user: { username: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          amountETB: true,
          reference: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          rejectionReason: true,
          user: { select: { id: true, firstName: true, lastName: true, username: true } },
          order: {
            select: {
              orderNumber: true,
              service: { select: { name: true } },
              package: { select: { name: true } },
            },
          },
          paymentMethod: { select: { name: true } },
        },
      }),
      prisma.payment.count({ where: where as never }),
    ]);

    res.json({ success: true, data: { payments, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/payments/:id
adminPaymentsRouter.get("/:id", async (req, res, next) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params["id"] },
      select: {
        id: true, amountETB: true, reference: true, screenshotKey: true,
        status: true, createdAt: true, reviewedAt: true, rejectionReason: true,
        idempotencyKey: true,
        user: {
          select: {
            id: true, firstName: true, lastName: true, username: true,
            telegramIdentity: { select: { telegramUserId: true } },
          },
        },
        order: {
          select: {
            id: true, orderNumber: true, targetUrl: true, targetType: true,
            totalAmountETB: true, orderStatus: true,
            service: { select: { name: true, platform: { select: { name: true } } } },
            package: { select: { name: true, quantity: true } },
          },
        },
        paymentMethod: { select: { id: true, name: true } },
        reviewer: { select: { firstName: true, lastName: true } },
      },
    });

    if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");

    // Generate signed proof URL for admin (1-hour validity)
    const proofSignedUrl = payment.screenshotKey
      ? await getSignedProofUrl(payment.screenshotKey, 3600)
      : null;

    res.json({ success: true, data: { ...payment, proofSignedUrl } });
  } catch (err) {
    next(err);
  }
});

const rejectSchema = z.object({
  rejectionReason: z.string().min(1).max(500).trim(),
});

// POST /api/v1/admin/payments/:id/approve
adminPaymentsRouter.post(
  "/:id/approve",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const result = await approvePayment(req.params["id"] as string, req.admin!.sub, req.ip as string | undefined);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/admin/payments/:id/reject
adminPaymentsRouter.post(
  "/:id/reject",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = rejectSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Rejection reason required");

      const result = await rejectPayment(req.params["id"] as string, req.admin!.sub, parsed.data.rejectionReason, req.ip as string | undefined);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);


