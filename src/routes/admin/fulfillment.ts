/**
 * Admin fulfillment routes
 *
 * GET  /api/v1/admin/fulfillment              — queue list
 * GET  /api/v1/admin/fulfillment/:id          — task detail
 * POST /api/v1/admin/fulfillment/:id/status   — update status
 * POST /api/v1/admin/fulfillment/:id/assign   — assign task to admin
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { updateFulfillmentStatus } from "../../services/fulfillment.service.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";
import type { FulfillmentStatus } from "../../shared/index.js";

export const adminFulfillmentRouter: IRouter = Router();
adminFulfillmentRouter.use(requireAdmin);

// GET /api/v1/admin/fulfillment
adminFulfillmentRouter.get("/", async (req, res, next) => {
  try {
    const status = req.query["status"] as string | undefined;
    const search = (req.query["search"] as string | undefined)?.trim();
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));

    const where: Record<string, unknown> = {};
    if (status) where["status"] = status;
    if (search) {
      where["OR"] = [
        { order: { orderNumber: { contains: search, mode: "insensitive" } } },
        { order: { user: { firstName: { contains: search, mode: "insensitive" } } } },
        { order: { user: { lastName: { contains: search, mode: "insensitive" } } } },
        { order: { user: { username: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [tasks, total] = await Promise.all([
      prisma.fulfillmentTask.findMany({
        where: where as never,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, fulfillmentType: true, status: true,
          requiresApproval: true, providerReference: true,
          startedAt: true, completedAt: true, createdAt: true,
          assignee: { select: { firstName: true, lastName: true } },
          order: {
            select: {
              id: true, orderNumber: true, targetUrl: true, targetType: true,
              totalAmountETB: true, paymentStatus: true,
              service: { select: { name: true, platform: { select: { name: true } } } },
              package: { select: { name: true, quantity: true } },
              user: { select: { firstName: true, lastName: true, username: true } },
            },
          },
        },
      }),
      prisma.fulfillmentTask.count({ where: where as never }),
    ]);

    res.json({ success: true, data: { tasks, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admin/fulfillment/:id
adminFulfillmentRouter.get("/:id", async (req, res, next) => {
  try {
    const task = await prisma.fulfillmentTask.findUnique({
      where: { id: req.params["id"] },
      include: {
        order: {
          include: {
            service: { include: { platform: true } },
            package: true,
            user: { include: { telegramIdentity: true } },
            payments: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { status: true, amountETB: true, reference: true },
            },
          },
        },
        assignee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!task) throw new AppError(404, "NOT_FOUND", "Fulfillment task not found");
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({
  status: z.enum(["QUEUED", "AWAITING_APPROVAL", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]),
  providerReference: z.string().optional(),
  errorMessage: z.string().optional(),
});

// POST /api/v1/admin/fulfillment/:id/status — ADMIN + SUPER_ADMIN only
adminFulfillmentRouter.post("/:id/status", requireRole("SUPER_ADMIN" as never, "ADMIN" as never), async (req, res, next) => {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid status data", parsed.error.flatten());

    const result = await updateFulfillmentStatus(
      req.params["id"] as string,
      parsed.data.status as FulfillmentStatus,
      req.admin!.sub,
      {
        providerReference: parsed.data.providerReference,
        errorMessage: parsed.data.errorMessage,
      }
    );

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/admin/fulfillment/:id/assign — ADMIN + SUPER_ADMIN only
adminFulfillmentRouter.post("/:id/assign", requireRole("SUPER_ADMIN" as never, "ADMIN" as never), async (req, res, next) => {
  try {
    const { adminId } = req.body as { adminId?: string };
    if (!adminId) throw new AppError(422, "VALIDATION_ERROR", "adminId is required");

    await prisma.fulfillmentTask.update({
      where: { id: req.params["id"] as string },
      data: { assignedTo: adminId },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});


