/**
 * Admin stats route
 *
 * GET /api/v1/admin/stats — dashboard KPI snapshot
 *
 * Queries are batched in two small groups to avoid exhausting the
 * pgbouncer connection pool (Supabase transaction pooler).
 */

import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { prisma } from "../../lib/prisma.js";

export const adminStatsRouter: IRouter = Router();
adminStatsRouter.use(requireAdmin);

adminStatsRouter.get("/", async (_req, res, next) => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // ── Batch 1: queue depths + today counts ─────────────────────────────────
    const [
      paymentsUnderReview,
      pendingFulfillment,
      failedFulfillment,
      ordersToday,
      approvedPaymentsToday,
    ] = await Promise.all([
      prisma.payment.count({ where: { status: "UNDER_REVIEW" } }),
      prisma.fulfillmentTask.count({ where: { status: "QUEUED" } }),
      prisma.fulfillmentTask.count({ where: { status: "FAILED" } }),
      prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.payment.count({ where: { status: "APPROVED", reviewedAt: { gte: todayStart } } }),
    ]);

    // ── Batch 2: aggregates + completed count ─────────────────────────────────
    const [
      completedOrdersToday,
      etbCollectedToday,
    ] = await Promise.all([
      prisma.order.count({ where: { orderStatus: "COMPLETED", completedAt: { gte: todayStart } } }),
      prisma.payment.aggregate({
        where: { status: "APPROVED", reviewedAt: { gte: todayStart } },
        _sum: { amountETB: true },
      }),
    ]);

    // ── Batch 3: needs-attention lists (top 5 each) ───────────────────────────
    const [awaitingReview, awaitingFulfillment] = await Promise.all([
      prisma.payment.findMany({
        where: { status: "UNDER_REVIEW" },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true, amountETB: true, createdAt: true,
          user: { select: { firstName: true, lastName: true, username: true } },
          order: { select: { orderNumber: true, service: { select: { name: true } } } },
        },
      }),
      prisma.fulfillmentTask.findMany({
        where: { status: "QUEUED" },
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          id: true, createdAt: true,
          order: {
            select: {
              orderNumber: true,
              service: { select: { name: true } },
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    // ── Batch 4: failed tasks ─────────────────────────────────────────────────
    const failedTasks = await prisma.fulfillmentTask.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true, errorMessage: true, updatedAt: true,
        order: {
          select: {
            orderNumber: true,
            service: { select: { name: true } },
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    res.json({
      success: true,
      data: {
        kpis: {
          paymentsUnderReview,
          pendingFulfillment,
          failedFulfillment,
          ordersToday,
          approvedPaymentsToday,
          completedOrdersToday,
          etbCollectedToday: etbCollectedToday._sum.amountETB ?? 0,
        },
        needsAttention: {
          awaitingReview,
          awaitingFulfillment,
          failedTasks,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
