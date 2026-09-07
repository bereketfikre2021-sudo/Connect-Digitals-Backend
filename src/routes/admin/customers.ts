/**
 * Admin customers routes
 *
 * GET /api/v1/admin/customers        — list customers (searchable, paginated)
 * GET /api/v1/admin/customers/:id    — customer detail with wallet, orders, payments
 */

import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";

export const adminCustomersRouter: IRouter = Router();
adminCustomersRouter.use(requireAdmin);

// GET /api/v1/admin/customers
adminCustomersRouter.get("/", async (req, res, next) => {
  try {
    const search = (req.query["search"] as string | undefined)?.trim();
    const page   = Math.max(1, parseInt((req.query["page"]     as string) ?? "1",  10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));

    const where: Record<string, unknown> = { deletedAt: null };
    if (search) {
      where["OR"] = [
        { firstName:  { contains: search, mode: "insensitive" } },
        { lastName:   { contains: search, mode: "insensitive" } },
        { username:   { contains: search, mode: "insensitive" } },
        { telegramIdentity: { telegramUserId: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
          status: true,
          createdAt: true,
          telegramIdentity: {
            select: { telegramUserId: true, isPremium: true, lastSeenAt: true },
          },
          wallet: {
            select: { balanceETB: true },
          },
          _count: {
            select: { orders: true },
          },
          // Sum of approved payments — done separately below for type-safety
        },
      }),
      prisma.user.count({ where: where as never }),
    ]);

    // Fetch total spend (sum of approved payments) for each user in one query
    const userIds = users.map(u => u.id);
    const spendRows = await prisma.payment.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, status: "APPROVED" },
      _sum: { amountETB: true },
    });
    const spendMap = Object.fromEntries(spendRows.map(r => [r.userId, r._sum.amountETB ?? 0]));

    const enriched = users.map(u => ({
      ...u,
      totalSpendETB: spendMap[u.id] ?? 0,
    }));

    res.json({
      success: true,
      data: { customers: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/customers/:id
adminCustomersRouter.get("/:id", async (req, res, next) => {
  try {
    const userId = req.params["id"] as string;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
        phone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        telegramIdentity: {
          select: {
            telegramUserId: true,
            username: true,
            isPremium: true,
            lastSeenAt: true,
            createdAt: true,
          },
        },
        wallet: {
          select: {
            id: true,
            balanceETB: true,
            updatedAt: true,
            transactions: {
              orderBy: { createdAt: "desc" },
              take: 10,
              select: {
                id: true,
                type: true,
                amountETB: true,
                balanceBefore: true,
                balanceAfter: true,
                description: true,
                createdAt: true,
              },
            },
          },
        },
        orders: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            orderNumber: true,
            totalAmountETB: true,
            orderStatus: true,
            paymentStatus: true,
            fulfillmentStatus: true,
            createdAt: true,
            completedAt: true,
            service: {
              select: {
                name: true,
                platform: { select: { name: true } },
              },
            },
            package: { select: { name: true, quantity: true } },
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            amountETB: true,
            reference: true,
            status: true,
            createdAt: true,
            reviewedAt: true,
            rejectionReason: true,
            paymentMethod: { select: { name: true } },
            order: { select: { orderNumber: true } },
          },
        },
      },
    });

    if (!user) throw new AppError(404, "NOT_FOUND", "Customer not found");

    // Total spend
    const spend = await prisma.payment.aggregate({
      where: { userId, status: "APPROVED" },
      _sum: { amountETB: true },
    });

    res.json({
      success: true,
      data: { ...user, totalSpendETB: spend._sum.amountETB ?? 0 },
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/v1/admin/customers/:id/status — SUPER_ADMIN + ADMIN ────────────
import { requireRole } from "../../middleware/admin-auth.js";
import { writeAuditLog } from "../../services/audit.service.js";
import { z } from "zod";

const customerStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
  reason: z.string().min(5, "Reason must be at least 5 characters").max(500),
});

adminCustomersRouter.patch(
  "/:id/status",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = customerStatusSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid status data", parsed.error.flatten());

      const userId = req.params["id"] as string;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true, status: true, deletedAt: true },
      });

      if (!user || user.deletedAt) throw new AppError(404, "NOT_FOUND", "Customer not found");

      if (user.status === parsed.data.status) {
        return res.json({ success: true, data: { status: parsed.data.status, changed: false } });
      }

      await prisma.user.update({
        where: { id: userId },
        data: { status: parsed.data.status as never },
      });

      const actionMap: Record<string, string> = {
        SUSPENDED: "CUSTOMER_SUSPENDED",
        BANNED: "CUSTOMER_BANNED",
        ACTIVE: "CUSTOMER_STATUS_RESTORED",
      };

      await writeAuditLog({
        actorId: req.admin!.sub,
        actorType: "ADMIN" as never,
        action: actionMap[parsed.data.status] ?? "CUSTOMER_STATUS_CHANGED",
        entityType: "User",
        entityId: userId,
        before: { status: user.status },
        after: { status: parsed.data.status, reason: parsed.data.reason },
      });

      res.json({ success: true, data: { status: parsed.data.status, changed: true } });
    } catch (err) { next(err); }
  }
);
