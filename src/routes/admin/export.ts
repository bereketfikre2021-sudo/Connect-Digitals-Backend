/**
 * Admin CSV export routes
 *
 * GET /api/v1/admin/export/orders    — download orders as CSV
 * GET /api/v1/admin/export/payments  — download payments as CSV
 * GET /api/v1/admin/export/customers — download customers as CSV
 *
 * Supports ?from=ISO&to=ISO date range filters.
 */

import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { prisma } from "../../lib/prisma.js";

export const adminExportRouter: IRouter = Router();
adminExportRouter.use(requireAdmin);

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [
    headers.join(","),
    ...rows.map(r => headers.map(h => escapeCSV(r[h])).join(",")),
  ];
  return lines.join("\n");
}

function dateRange(req: { query: Record<string, unknown> }) {
  const from = req.query["from"] as string | undefined;
  const to   = req.query["to"]   as string | undefined;
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    },
  };
}

function dateWhereWithDeletedAt(req: { query: Record<string, unknown> }) {
  const range = dateRange(req);
  return { deletedAt: null as null, ...range };
}

// GET /api/v1/admin/export/orders
adminExportRouter.get("/orders", async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      where: dateRange(req) as never,
      orderBy: { createdAt: "desc" },
      take: 10000,
      select: {
        orderNumber: true, createdAt: true, orderStatus: true,
        paymentStatus: true, fulfillmentStatus: true,
        totalAmountETB: true, completedAt: true, targetUrl: true,
        user:    { select: { firstName: true, lastName: true, username: true } },
        service: { select: { name: true } },
        package: { select: { name: true, quantity: true } },
      },
    });

    const rows = orders.map(o => ({
      "Order #":        o.orderNumber,
      "Date":           o.createdAt.toISOString(),
      "Customer":       `${o.user.firstName} ${o.user.lastName ?? ""}`.trim(),
      "Username":       o.user.username ?? "",
      "Service":        o.service.name,
      "Package":        o.package.name,
      "Quantity":       o.package.quantity,
      "Amount (ETB)":   (o.totalAmountETB / 100).toFixed(2),
      "Order Status":   o.orderStatus,
      "Payment Status": o.paymentStatus,
      "Fulfillment":    o.fulfillmentStatus,
      "Completed At":   o.completedAt?.toISOString() ?? "",
      "Target URL":     o.targetUrl,
    }));

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="orders-${Date.now()}.csv"`);
    res.send(toCSV(rows));
  } catch (err) { next(err); }
});

// GET /api/v1/admin/export/payments
adminExportRouter.get("/payments", async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: dateRange(req) as never,
      orderBy: { createdAt: "desc" },
      take: 10000,
      select: {
        createdAt: true, status: true, amountETB: true, reference: true,
        reviewedAt: true, rejectionReason: true,
        user:          { select: { firstName: true, lastName: true, username: true } },
        order:         { select: { orderNumber: true } },
        paymentMethod: { select: { name: true } },
        reviewer:      { select: { firstName: true, lastName: true } },
      },
    });

    const rows = payments.map(p => ({
      "Date":          p.createdAt.toISOString(),
      "Customer":      `${p.user.firstName} ${p.user.lastName ?? ""}`.trim(),
      "Username":      p.user.username ?? "",
      "Order #":       p.order?.orderNumber ?? "Deposit",
      "Method":        p.paymentMethod.name,
      "Amount (ETB)":  (p.amountETB / 100).toFixed(2),
      "Reference":     p.reference,
      "Status":        p.status,
      "Reviewed At":   p.reviewedAt?.toISOString() ?? "",
      "Reviewer":      p.reviewer ? `${p.reviewer.firstName} ${p.reviewer.lastName}` : "",
      "Reject Reason": p.rejectionReason ?? "",
    }));

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="payments-${Date.now()}.csv"`);
    res.send(toCSV(rows));
  } catch (err) { next(err); }
});

// GET /api/v1/admin/export/customers
adminExportRouter.get("/customers", async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: dateWhereWithDeletedAt(req) as never,
      orderBy: { createdAt: "desc" },
      take: 10000,
      select: {
        firstName: true, lastName: true, username: true, status: true, createdAt: true,
        wallet:          { select: { balanceETB: true } },
        telegramIdentity:{ select: { telegramUserId: true, isPremium: true, lastSeenAt: true } },
        _count:          { select: { orders: true } },
      },
    });

    const rows = users.map(u => ({
      "First Name":    u.firstName,
      "Last Name":     u.lastName ?? "",
      "Username":      u.username ?? "",
      "Status":        u.status,
      "Joined":        u.createdAt.toISOString(),
      "Telegram ID":   u.telegramIdentity?.telegramUserId ?? "",
      "Premium":       u.telegramIdentity?.isPremium ? "Yes" : "No",
      "Last Seen":     u.telegramIdentity?.lastSeenAt?.toISOString() ?? "",
      "Orders":        u._count.orders,
      "Wallet (ETB)":  ((u.wallet?.balanceETB ?? 0) / 100).toFixed(2),
    }));

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="customers-${Date.now()}.csv"`);
    res.send(toCSV(rows));
  } catch (err) { next(err); }
});
