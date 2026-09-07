/**
 * Admin analytics route
 *
 * GET /api/v1/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Queries are split into sequential batches to avoid exhausting the
 * Supabase pgbouncer transaction pooler connection pool.
 */

import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../middleware/error.js";

export const adminAnalyticsRouter: IRouter = Router();
adminAnalyticsRouter.use(requireAdmin);

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (isNaN(d.getTime())) return fallback;
  return d;
}

adminAnalyticsRouter.get("/", async (req, res, next) => {
  try {
    // ── Date range ────────────────────────────────────────────────────────────
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
    defaultFrom.setUTCHours(0, 0, 0, 0);

    const defaultTo = new Date(now);
    defaultTo.setUTCHours(23, 59, 59, 999);

    const from = parseDate(req.query["from"] as string | undefined, defaultFrom);
    const toRaw = parseDate(req.query["to"] as string | undefined, defaultTo);
    const to = new Date(toRaw);
    to.setUTCHours(23, 59, 59, 999);

    if (from > to) throw new AppError(400, "INVALID_DATE_RANGE", "from must be before to");

    const dateFilter   = { gte: from, lte: to };
    const createdFilter = { createdAt: dateFilter };

    // ── Batch 1: customer counts ──────────────────────────────────────────────
    const [totalCustomers, newCustomers] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, ...createdFilter } }),
    ]);

    // ── Batch 2: order counts + by-status breakdown ───────────────────────────
    const [totalOrders, ordersByStatus] = await Promise.all([
      prisma.order.count({ where: createdFilter }),
      prisma.order.groupBy({
        by: ["orderStatus"],
        where: createdFilter,
        _count: { _all: true },
      }),
    ]);

    // ── Batch 3: payment aggregates ───────────────────────────────────────────
    const [paymentsByStatus, revenueApproved, revenueUnderReview] = await Promise.all([
      prisma.payment.groupBy({
        by: ["status"],
        where: createdFilter,
        _count: { _all: true },
        _sum: { amountETB: true },
      }),
      prisma.payment.aggregate({
        where: { status: "APPROVED", reviewedAt: dateFilter },
        _sum: { amountETB: true },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({
        where: { status: "UNDER_REVIEW", createdAt: dateFilter },
        _sum: { amountETB: true },
        _count: { _all: true },
      }),
    ]);

    // ── Batch 4: wallet aggregates ────────────────────────────────────────────
    const [walletDepositsAgg, walletUsageAgg, walletBalanceAgg] = await Promise.all([
      prisma.walletTransaction.aggregate({
        where: { type: "DEPOSIT", createdAt: dateFilter },
        _sum: { amountETB: true },
        _count: { _all: true },
      }),
      prisma.walletTransaction.aggregate({
        where: { type: "ORDER_PAYMENT", createdAt: dateFilter },
        _sum: { amountETB: true },
        _count: { _all: true },
      }),
      prisma.wallet.aggregate({
        _sum: { balanceETB: true },
        _count: { _all: true },
        _avg: { balanceETB: true },
      }),
    ]);

    // ── Batch 5: fulfillment + campaigns ─────────────────────────────────────
    const [fulfillmentByStatus, campaignsByStatus] = await Promise.all([
      prisma.fulfillmentTask.groupBy({
        by: ["status"],
        where: createdFilter,
        _count: { _all: true },
      }),
      prisma.campaign.groupBy({
        by: ["internalStatus"],
        where: createdFilter,
        _count: { _all: true },
      }),
    ]);

    // ── Batch 6: completion counts + top services ─────────────────────────────
    const [totalCompletableOrders, completedOrdersInRange, ordersByService] = await Promise.all([
      prisma.order.count({
        where: {
          createdAt: dateFilter,
          orderStatus: { notIn: ["PENDING_PAYMENT", "PAYMENT_SUBMITTED"] },
        },
      }),
      prisma.order.count({ where: { createdAt: dateFilter, orderStatus: "COMPLETED" } }),
      prisma.order.groupBy({
        by: ["serviceId"],
        where: createdFilter,
        _count: { _all: true },
        _sum: { totalAmountETB: true },
        orderBy: { _count: { serviceId: "desc" } },
        take: 10,
      }),
    ]);

    // ── Enrich service names (sequential — depends on batch 6 result) ─────────
    const serviceIds = ordersByService.map(r => r.serviceId);
    const services = serviceIds.length > 0
      ? await prisma.promotionService.findMany({
          where: { id: { in: serviceIds } },
          select: { id: true, name: true, platform: { select: { name: true } } },
        })
      : [];
    const serviceMap = Object.fromEntries(services.map(s => [s.id, s]));

    const serviceBreakdown = ordersByService.map(r => ({
      serviceId:   r.serviceId,
      serviceName: serviceMap[r.serviceId]?.name ?? "Unknown",
      platform:    serviceMap[r.serviceId]?.platform.name ?? "Unknown",
      orderCount:  r._count._all,
      revenueETB:  r._sum.totalAmountETB ?? 0,
    }));

    // ── Campaign metrics aggregate ────────────────────────────────────────────
    const campaignIdsInRange = (await prisma.campaign.findMany({
      where: createdFilter,
      select: { id: true },
    })).map(c => c.id);

    const campaignMetricsAgg = campaignIdsInRange.length > 0
      ? await prisma.campaignMetric.aggregate({
          where: { campaignId: { in: campaignIdsInRange } },
          _sum: {
            impressions: true, reach: true, clicks: true,
            videoViews: true, likes: true, comments: true,
            shares: true, engagement: true, conversions: true, spendETB: true,
          },
          _count: { _all: true },
        })
      : null;

    // ── Completion rate ───────────────────────────────────────────────────────
    const completionRatePct = totalCompletableOrders > 0
      ? Math.round((completedOrdersInRange / totalCompletableOrders) * 100)
      : null;

    res.json({
      success: true,
      data: {
        range: { from: from.toISOString(), to: to.toISOString() },

        customers: {
          total: totalCustomers,
          newInRange: newCustomers,
        },

        orders: {
          total: totalOrders,
          byStatus: Object.fromEntries(
            ordersByStatus.map(r => [r.orderStatus, r._count._all])
          ),
          completionRatePct,
          completedInRange: completedOrdersInRange,
        },

        payments: {
          byStatus: Object.fromEntries(
            paymentsByStatus.map(r => [r.status, { count: r._count._all, totalETB: r._sum.amountETB ?? 0 }])
          ),
          approvedRevenue: {
            totalETB: revenueApproved._sum.amountETB ?? 0,
            count:    revenueApproved._count._all,
          },
          underReview: {
            totalETB: revenueUnderReview._sum.amountETB ?? 0,
            count:    revenueUnderReview._count._all,
          },
        },

        wallet: {
          deposits: {
            totalETB: walletDepositsAgg._sum.amountETB ?? 0,
            count:    walletDepositsAgg._count._all,
          },
          orderPayments: {
            totalETB: walletUsageAgg._sum.amountETB ?? 0,
            count:    walletUsageAgg._count._all,
          },
          currentBalances: {
            totalETB:    walletBalanceAgg._sum.balanceETB ?? 0,
            averageETB:  Math.round(walletBalanceAgg._avg.balanceETB ?? 0),
            walletCount: walletBalanceAgg._count._all,
          },
        },

        fulfillment: {
          byStatus: Object.fromEntries(
            fulfillmentByStatus.map(r => [r.status, r._count._all])
          ),
        },

        campaigns: {
          byStatus: Object.fromEntries(
            campaignsByStatus.map(r => [r.internalStatus, r._count._all])
          ),
          metricsAggregate: campaignMetricsAgg ? {
            snapshotCount: campaignMetricsAgg._count._all,
            impressions:   campaignMetricsAgg._sum.impressions  ?? 0,
            reach:         campaignMetricsAgg._sum.reach        ?? 0,
            clicks:        campaignMetricsAgg._sum.clicks       ?? 0,
            videoViews:    campaignMetricsAgg._sum.videoViews   ?? 0,
            likes:         campaignMetricsAgg._sum.likes        ?? 0,
            comments:      campaignMetricsAgg._sum.comments     ?? 0,
            shares:        campaignMetricsAgg._sum.shares       ?? 0,
            engagement:    campaignMetricsAgg._sum.engagement   ?? 0,
            conversions:   campaignMetricsAgg._sum.conversions  ?? 0,
            spendETB:      campaignMetricsAgg._sum.spendETB     ?? 0,
          } : null,
        },

        services: serviceBreakdown,
      },
    });
  } catch (err) {
    next(err);
  }
});
