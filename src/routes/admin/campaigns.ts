/**
 * Admin campaign routes
 *
 * GET    /api/v1/admin/campaigns                    — list campaigns
 * GET    /api/v1/admin/campaigns/:id                — campaign detail + metrics
 * POST   /api/v1/admin/campaigns                    — create campaign for an order
 * PATCH  /api/v1/admin/campaigns/:id/status         — manual status update
 * POST   /api/v1/admin/campaigns/:id/metrics        — upsert manual metric snapshot
 * POST   /api/v1/admin/campaigns/:id/launch         — launch via provider (Phase 7)
 * POST   /api/v1/admin/campaigns/:id/pause          — pause via provider
 * POST   /api/v1/admin/campaigns/:id/resume         — resume via provider
 * POST   /api/v1/admin/campaigns/:id/cancel         — cancel via provider
 * POST   /api/v1/admin/campaigns/:id/retry          — retry failed campaign
 * POST   /api/v1/admin/campaigns/:id/sync-metrics   — pull metrics from provider
 * POST   /api/v1/admin/campaigns/:id/generate-report — auto-generate draft report
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { sendNotification } from "../../services/notification.service.js";
import { writeAuditLog } from "../../services/audit.service.js";
import {
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaignViaProvider,
  retryCampaign,
  syncCampaignMetrics,
  generateCampaignReport,
} from "../../services/campaign.service.js";
import { z } from "zod";

export const adminCampaignsRouter: IRouter = Router();
adminCampaignsRouter.use(requireAdmin);

// ── List ─────────────────────────────────────────────────────────────────────
adminCampaignsRouter.get("/", async (req, res, next) => {
  try {
    const status = req.query["status"] as string | undefined;
    const search = (req.query["search"] as string | undefined)?.trim();
    const page     = Math.max(1, parseInt((req.query["page"]     as string) ?? "1",  10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));

    const where: Record<string, unknown> = {};
    if (status) where["internalStatus"] = status;
    if (search) {
      where["OR"] = [
        { order: { orderNumber: { contains: search, mode: "insensitive" } } },
        { order: { user: { firstName: { contains: search, mode: "insensitive" } } } },
        { order: { user: { lastName:  { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, internalStatus: true, provider: true,
          startDate: true, endDate: true, createdAt: true,
          order: {
            select: {
              id: true, orderNumber: true, totalAmountETB: true,
              service: { select: { name: true, platform: { select: { name: true } } } },
              package: { select: { quantity: true } },
              user: { select: { id: true, firstName: true, lastName: true, username: true } },
            },
          },
          _count: { select: { metrics: true } },
        },
      }),
      prisma.campaign.count({ where: where as never }),
    ]);

    res.json({ success: true, data: { campaigns, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) { next(err); }
});

// ── Detail ───────────────────────────────────────────────────────────────────
adminCampaignsRouter.get("/:id", async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params["id"] as string },
      include: {
        order: {
          select: {
            id: true, orderNumber: true, targetUrl: true, totalAmountETB: true,
            orderStatus: true, fulfillmentStatus: true,
            service: { select: { name: true, targetLabel: true, platform: { select: { name: true } } } },
            package: { select: { name: true, quantity: true, deliveryDaysMin: true, deliveryDaysMax: true } },
            user: { select: { id: true, firstName: true, lastName: true, username: true, telegramIdentity: { select: { telegramUserId: true } } } },
          },
        },
        fulfillmentTask: {
          select: { id: true, status: true, fulfillmentType: true, startedAt: true, completedAt: true },
        },
        metrics: {
          orderBy: { date: "desc" },
          select: {
            id: true, date: true, source: true,
            impressions: true, reach: true, clicks: true, ctrBps: true,
            videoViews: true, likes: true, comments: true, shares: true,
            engagement: true, conversions: true, spendETB: true,
            createdAt: true, updatedAt: true,
          },
        },
        reports: {
          select: { id: true, title: true, status: true, publishedAt: true, createdAt: true },
        },
      },
    });

    if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found");
    res.json({ success: true, data: campaign });
  } catch (err) { next(err); }
});

// ── Create campaign for an order ─────────────────────────────────────────────
const createCampaignSchema = z.object({
  orderId:       z.string().cuid(),
  objective:     z.string().max(200).optional(),
  startDate:     z.string().datetime().optional(),
  endDate:       z.string().datetime().optional(),
  durationDays:  z.number().int().positive().optional(),
  budgetETB:     z.number().int().positive().optional(),
  dailyBudgetETB:z.number().int().positive().optional(),
  notes:         z.string().max(500).optional(),
});

adminCampaignsRouter.post(
  "/",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = createCampaignSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid campaign data", parsed.error.flatten());

      // Order must exist and have a fulfillment task
      const order = await prisma.order.findUnique({
        where: { id: parsed.data.orderId },
        select: { id: true, fulfillmentTask: { select: { id: true } } },
      });
      if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");
      if (!order.fulfillmentTask) throw new AppError(409, "NO_FULFILLMENT_TASK", "Order has no fulfillment task yet");

      // Idempotent
      const existing = await prisma.campaign.findUnique({ where: { orderId: parsed.data.orderId } });
      if (existing) return res.json({ success: true, data: existing });

      const campaign = await prisma.campaign.create({
        data: {
          orderId: parsed.data.orderId,
          fulfillmentTaskId: order.fulfillmentTask.id,
          targetUrl: (await prisma.order.findUnique({ where: { id: parsed.data.orderId }, select: { targetUrl: true } }))!.targetUrl,
          objective:      parsed.data.objective,
          startDate:      parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
          endDate:        parsed.data.endDate   ? new Date(parsed.data.endDate)   : undefined,
          durationDays:   parsed.data.durationDays,
          budgetETB:      parsed.data.budgetETB,
          dailyBudgetETB: parsed.data.dailyBudgetETB,
          internalStatus: "DRAFT",
        },
      });

      res.status(201).json({ success: true, data: campaign });
    } catch (err) { next(err); }
  }
);

// ── Update status ─────────────────────────────────────────────────────────────
const statusSchema = z.object({
  status: z.enum(["DRAFT", "PENDING", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]),
});

adminCampaignsRouter.patch(
  "/:id/status",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid status");

      const campaign = await prisma.campaign.findUnique({
        where: { id: req.params["id"] as string },
        select: {
          id: true, internalStatus: true,
          order: {
            select: {
              id: true, orderNumber: true, userId: true,
              service: { select: { name: true } },
            },
          },
        },
      });
      if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found");

      const newStatus = parsed.data.status;
      const now = new Date();

      const updateData: Record<string, unknown> = { internalStatus: newStatus };
      if (newStatus === "ACTIVE" && !campaign.internalStatus.includes("ACTIVE")) {
        updateData["startDate"] = now;
      }
      if (["COMPLETED", "CANCELLED", "FAILED"].includes(newStatus)) {
        updateData["endDate"] = now;
      }

      await prisma.campaign.update({ where: { id: campaign.id }, data: updateData as never });

      await writeAuditLog({
        actorId: req.admin!.sub,
        actorType: "ADMIN" as never,
        action: "CAMPAIGN_UPDATED",
        entityType: "Campaign",
        entityId: campaign.id,
        before: { internalStatus: campaign.internalStatus },
        after: { internalStatus: newStatus },
        orderId: campaign.order.id,
      });

      // Notify customer on ACTIVE and COMPLETED
      if (newStatus === "ACTIVE") {
        await sendNotification(campaign.order.userId, "FULFILLMENT_STARTED", {
          orderNumber: campaign.order.orderNumber,
          serviceName: campaign.order.service.name,
          deliveryDays: "see your campaign details",
        });
      }
      if (newStatus === "COMPLETED") {
        await sendNotification(campaign.order.userId, "ORDER_COMPLETED", {
          orderNumber: campaign.order.orderNumber,
          serviceName: campaign.order.service.name,
        });
      }

      res.json({ success: true, data: { internalStatus: newStatus } });
    } catch (err) { next(err); }
  }
);

// ── Upsert metric snapshot ────────────────────────────────────────────────────
const metricsSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  source:      z.enum(["MANUAL", "PROVIDER_API"]).default("MANUAL"),
  impressions: z.number().int().nonnegative().optional(),
  reach:       z.number().int().nonnegative().optional(),
  clicks:      z.number().int().nonnegative().optional(),
  videoViews:  z.number().int().nonnegative().optional(),
  likes:       z.number().int().nonnegative().optional(),
  comments:    z.number().int().nonnegative().optional(),
  shares:      z.number().int().nonnegative().optional(),
  engagement:  z.number().int().nonnegative().optional(),
  conversions: z.number().int().nonnegative().optional(),
  spendETB:    z.number().int().nonnegative().optional(),
});

adminCampaignsRouter.post(
  "/:id/metrics",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = metricsSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid metrics data", parsed.error.flatten());

      const campaign = await prisma.campaign.findUnique({
        where: { id: req.params["id"] as string },
        select: { id: true },
      });
      if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found");

      const metric = await prisma.campaignMetric.upsert({
        where: {
          campaignId_date_source: {
            campaignId: campaign.id,
            date: new Date(parsed.data.date),
            source: parsed.data.source,
          },
        },
        update: {
          impressions: parsed.data.impressions,
          reach:       parsed.data.reach,
          clicks:      parsed.data.clicks,
          videoViews:  parsed.data.videoViews,
          likes:       parsed.data.likes,
          comments:    parsed.data.comments,
          shares:      parsed.data.shares,
          engagement:  parsed.data.engagement,
          conversions: parsed.data.conversions,
          spendETB:    parsed.data.spendETB,
        },
        create: {
          campaignId: campaign.id,
          date:       new Date(parsed.data.date),
          source:     parsed.data.source,
          impressions: parsed.data.impressions,
          reach:       parsed.data.reach,
          clicks:      parsed.data.clicks,
          videoViews:  parsed.data.videoViews,
          likes:       parsed.data.likes,
          comments:    parsed.data.comments,
          shares:      parsed.data.shares,
          engagement:  parsed.data.engagement,
          conversions: parsed.data.conversions,
          spendETB:    parsed.data.spendETB,
        },
      });

      res.json({ success: true, data: metric });
    } catch (err) { next(err); }
  }
);

// ── Launch via provider (Phase 7) ─────────────────────────────────────────────
const launchSchema = z.object({
  dryRun: z.boolean().default(false),
});

adminCampaignsRouter.post(
  "/:id/launch",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = launchSchema.safeParse(req.body);
      const dryRun = parsed.success ? parsed.data.dryRun : false;

      const result = await launchCampaign(req.params["id"] as string, {
        adminId: req.admin!.sub,
        dryRun,
      });

      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
);

// ── Pause via provider ────────────────────────────────────────────────────────
adminCampaignsRouter.post(
  "/:id/pause",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      await pauseCampaign(req.params["id"] as string, { adminId: req.admin!.sub });
      res.json({ success: true, data: { internalStatus: "PAUSED" } });
    } catch (err) { next(err); }
  }
);

// ── Resume via provider ───────────────────────────────────────────────────────
adminCampaignsRouter.post(
  "/:id/resume",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      await resumeCampaign(req.params["id"] as string, { adminId: req.admin!.sub });
      res.json({ success: true, data: { internalStatus: "ACTIVE" } });
    } catch (err) { next(err); }
  }
);

// ── Cancel via provider ───────────────────────────────────────────────────────
adminCampaignsRouter.post(
  "/:id/cancel",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      await cancelCampaignViaProvider(req.params["id"] as string, { adminId: req.admin!.sub });
      res.json({ success: true, data: { internalStatus: "CANCELLED" } });
    } catch (err) { next(err); }
  }
);

// ── Retry failed campaign ─────────────────────────────────────────────────────
adminCampaignsRouter.post(
  "/:id/retry",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const result = await retryCampaign(req.params["id"] as string, { adminId: req.admin!.sub });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
);

// ── Sync metrics from provider ────────────────────────────────────────────────
adminCampaignsRouter.post(
  "/:id/sync-metrics",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const result = await syncCampaignMetrics(req.params["id"] as string, { adminId: req.admin!.sub });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
);

// ── Generate draft report ─────────────────────────────────────────────────────
const generateReportSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

adminCampaignsRouter.post(
  "/:id/generate-report",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = generateReportSchema.safeParse(req.body);
      const title = parsed.success ? parsed.data.title : undefined;

      const result = await generateCampaignReport(req.params["id"] as string, {
        adminId: req.admin!.sub,
        title,
      });

      res.status(result.created ? 201 : 200).json({ success: true, data: result });
    } catch (err) { next(err); }
  }
);
