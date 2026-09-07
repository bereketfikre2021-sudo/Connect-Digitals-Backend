/**
 * Admin report routes
 *
 * GET    /api/v1/admin/reports                      — list reports
 * GET    /api/v1/admin/reports/:id                  — report detail
 * POST   /api/v1/admin/reports                      — create draft report for an order
 * PATCH  /api/v1/admin/reports/:id                  — update title / period / summary
 * POST   /api/v1/admin/reports/:id/publish          — publish to customer
 * POST   /api/v1/admin/reports/:id/archive          — archive report
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { sendNotification } from "../../services/notification.service.js";
import { writeAuditLog } from "../../services/audit.service.js";
import { z } from "zod";

export const adminReportsRouter: IRouter = Router();
adminReportsRouter.use(requireAdmin);

// ── List ─────────────────────────────────────────────────────────────────────
adminReportsRouter.get("/", async (req, res, next) => {
  try {
    const status   = req.query["status"] as string | undefined;
    const search   = (req.query["search"] as string | undefined)?.trim();
    const page     = Math.max(1, parseInt((req.query["page"]     as string) ?? "1",  10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));

    const where: Record<string, unknown> = {};
    if (status) where["status"] = status;
    if (search) {
      where["OR"] = [
        { title: { contains: search, mode: "insensitive" } },
        { order: { orderNumber: { contains: search, mode: "insensitive" } } },
        { order: { user: { firstName: { contains: search, mode: "insensitive" } } } },
        { order: { user: { lastName:  { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, title: true, status: true, publishedAt: true, createdAt: true,
          periodStart: true, periodEnd: true,
          order: {
            select: {
              id: true, orderNumber: true,
              service: { select: { name: true, platform: { select: { name: true } } } },
              user: { select: { firstName: true, lastName: true, username: true } },
            },
          },
          campaign: { select: { id: true, internalStatus: true } },
        },
      }),
      prisma.report.count({ where: where as never }),
    ]);

    res.json({ success: true, data: { reports, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) { next(err); }
});

// ── Detail ───────────────────────────────────────────────────────────────────
adminReportsRouter.get("/:id", async (req, res, next) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: req.params["id"] as string },
      include: {
        order: {
          select: {
            id: true, orderNumber: true, targetUrl: true, totalAmountETB: true,
            orderStatus: true,
            service: { select: { name: true, targetLabel: true, platform: { select: { name: true } } } },
            package: { select: { name: true, quantity: true } },
            user: {
              select: {
                id: true, firstName: true, lastName: true, username: true,
                telegramIdentity: { select: { telegramUserId: true } },
              },
            },
          },
        },
        campaign: {
          select: {
            id: true, internalStatus: true, startDate: true, endDate: true,
            metrics: {
              orderBy: { date: "desc" },
              select: {
                id: true, date: true, source: true,
                impressions: true, reach: true, clicks: true,
                videoViews: true, likes: true, comments: true,
                shares: true, engagement: true, conversions: true, spendETB: true,
              },
            },
          },
        },
      },
    });

    if (!report) throw new AppError(404, "NOT_FOUND", "Report not found");
    res.json({ success: true, data: report });
  } catch (err) { next(err); }
});

// ── Create ───────────────────────────────────────────────────────────────────
const createReportSchema = z.object({
  orderId:     z.string().cuid(),
  campaignId:  z.string().cuid().optional(),
  title:       z.string().min(1).max(200),
  periodStart: z.string().datetime().optional(),
  periodEnd:   z.string().datetime().optional(),
  summary:     z.record(z.unknown()).optional(),
});

adminReportsRouter.post(
  "/",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = createReportSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid report data", parsed.error.flatten());

      const order = await prisma.order.findUnique({
        where: { id: parsed.data.orderId },
        select: { id: true },
      });
      if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");

      const report = await prisma.report.create({
        data: {
          orderId:     parsed.data.orderId,
          campaignId:  parsed.data.campaignId,
          title:       parsed.data.title,
          periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : undefined,
          periodEnd:   parsed.data.periodEnd   ? new Date(parsed.data.periodEnd)   : undefined,
          summary:     parsed.data.summary as never,
          status:      "DRAFT",
          generatedAt: new Date(),
        },
      });

      res.status(201).json({ success: true, data: report });
    } catch (err) { next(err); }
  }
);

// ── Update (title / period / summary / notes) ────────────────────────────────
const updateReportSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  periodStart: z.string().datetime().optional().nullable(),
  periodEnd:   z.string().datetime().optional().nullable(),
  summary:     z.record(z.unknown()).optional(),
});

adminReportsRouter.patch(
  "/:id",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = updateReportSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid update data", parsed.error.flatten());

      const report = await prisma.report.findUnique({
        where: { id: req.params["id"] as string },
        select: { id: true, status: true },
      });
      if (!report) throw new AppError(404, "NOT_FOUND", "Report not found");
      if (report.status === "ARCHIVED") throw new AppError(409, "ARCHIVED", "Cannot edit an archived report");

      const updated = await prisma.report.update({
        where: { id: report.id },
        data: {
          ...(parsed.data.title       !== undefined ? { title:       parsed.data.title }       : {}),
          ...(parsed.data.periodStart !== undefined ? { periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : null } : {}),
          ...(parsed.data.periodEnd   !== undefined ? { periodEnd:   parsed.data.periodEnd   ? new Date(parsed.data.periodEnd)   : null } : {}),
          ...(parsed.data.summary     !== undefined ? { summary:     parsed.data.summary as never } : {}),
        },
      });

      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }
);

// ── Publish ──────────────────────────────────────────────────────────────────
adminReportsRouter.post(
  "/:id/publish",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const report = await prisma.report.findUnique({
        where: { id: req.params["id"] as string },
        select: {
          id: true, title: true, status: true,
          order: {
            select: {
              id: true, orderNumber: true, userId: true,
              service: { select: { name: true } },
            },
          },
        },
      });
      if (!report) throw new AppError(404, "NOT_FOUND", "Report not found");
      if (report.status === "PUBLISHED") return res.json({ success: true, data: { status: "PUBLISHED" } });
      if (report.status === "ARCHIVED") throw new AppError(409, "ARCHIVED", "Cannot publish an archived report");

      const now = new Date();
      await prisma.report.update({
        where: { id: report.id },
        data: { status: "PUBLISHED", publishedAt: now },
      });

      await writeAuditLog({
        actorId:    req.admin!.sub,
        actorType:  "ADMIN" as never,
        action:     "REPORT_PUBLISHED",
        entityType: "Report",
        entityId:   report.id,
        before:     { status: report.status },
        after:      { status: "PUBLISHED" },
        orderId:    report.order.id,
      });

      // Notify customer
      await sendNotification(report.order.userId, "REPORT_AVAILABLE", {
        orderNumber: report.order.orderNumber,
        serviceName: report.order.service.name,
        reportTitle: report.title,
      });

      res.json({ success: true, data: { status: "PUBLISHED", publishedAt: now } });
    } catch (err) { next(err); }
  }
);

// ── Archive ──────────────────────────────────────────────────────────────────
adminReportsRouter.post(
  "/:id/archive",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const report = await prisma.report.findUnique({
        where: { id: req.params["id"] as string },
        select: { id: true, status: true },
      });
      if (!report) throw new AppError(404, "NOT_FOUND", "Report not found");

      await prisma.report.update({
        where: { id: report.id },
        data: { status: "ARCHIVED" },
      });

      res.json({ success: true, data: { status: "ARCHIVED" } });
    } catch (err) { next(err); }
  }
);
