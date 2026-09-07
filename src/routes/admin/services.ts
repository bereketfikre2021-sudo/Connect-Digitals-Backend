/**
 * Admin services & packages routes
 *
 * GET    /api/v1/admin/services                        — list all services
 * POST   /api/v1/admin/services                        — create service
 * PATCH  /api/v1/admin/services/:id                    — update service
 * DELETE /api/v1/admin/services/:id                    — deactivate service
 *
 * GET    /api/v1/admin/services/:id/packages           — list packages for service
 * POST   /api/v1/admin/services/:id/packages           — create package
 * PATCH  /api/v1/admin/services/:serviceId/packages/:id — update package
 * DELETE /api/v1/admin/services/:serviceId/packages/:id — deactivate package
 */

import { Router, type IRouter } from "express";
import { requireAdmin, requireRole } from "../../middleware/admin-auth.js";
import { AppError } from "../../middleware/error.js";
import { prisma } from "../../lib/prisma.js";
import { z } from "zod";

export const adminServicesRouter: IRouter = Router();
adminServicesRouter.use(requireAdmin);

// ── List services ─────────────────────────────────────────────────────────────
adminServicesRouter.get("/", async (_req, res, next) => {
  try {
    const services = await prisma.promotionService.findMany({
      orderBy: [{ platform: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      include: {
        platform: { select: { id: true, name: true, slug: true } },
        packages: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true, name: true, description: true, quantity: true,
            priceETB: true, deliveryDaysMin: true, deliveryDaysMax: true,
            isActive: true, sortOrder: true,
          },
        },
        _count: { select: { orders: true } },
      },
    });
    res.json({ success: true, data: services });
  } catch (err) { next(err); }
});

// ── Create service ────────────────────────────────────────────────────────────
const serviceSchema = z.object({
  platformId:           z.string().cuid(),
  name:                 z.string().min(1).max(200),
  slug:                 z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase with hyphens"),
  description:          z.string().max(2000).optional(),
  shortDescription:     z.string().max(300).optional(),
  targetType:           z.enum(["PAGE","PROFILE","POST","VIDEO","CHANNEL","WEBSITE","CUSTOM"]),
  targetLabel:          z.string().min(1).max(100),
  targetPlaceholder:    z.string().min(1).max(200),
  targetHelpText:       z.string().max(500).optional(),
  requiresTargetUrl:    z.boolean().optional().default(true),
  fulfillmentType:      z.enum(["MANUAL","META_ADS","GOOGLE_ADS","TIKTOK_ADS","CUSTOM"]).optional().default("MANUAL"),
  requiresHumanApproval:z.boolean().optional().default(false),
  isActive:             z.boolean().optional().default(true),
  sortOrder:            z.number().int().min(0).optional().default(0),
});

adminServicesRouter.post(
  "/",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = serviceSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid service data", parsed.error.flatten());

      // Check slug uniqueness
      const slugExists = await prisma.promotionService.findUnique({ where: { slug: parsed.data.slug } });
      if (slugExists) throw new AppError(409, "SLUG_TAKEN", `Slug "${parsed.data.slug}" is already in use`);

      const service = await prisma.promotionService.create({
        data: parsed.data as never,
        include: { platform: { select: { name: true, slug: true } } },
      });
      res.status(201).json({ success: true, data: service });
    } catch (err) { next(err); }
  }
);

// ── Update service ────────────────────────────────────────────────────────────
const updateServiceSchema = serviceSchema.omit({ slug: true, platformId: true }).partial();

adminServicesRouter.patch(
  "/:id",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const parsed = updateServiceSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid update data", parsed.error.flatten());

      const existing = await prisma.promotionService.findUnique({ where: { id: req.params["id"] as string } });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Service not found");

      const updated = await prisma.promotionService.update({
        where: { id: req.params["id"] as string },
        data: parsed.data as never,
        include: { platform: { select: { name: true, slug: true } } },
      });
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }
);

// ── Deactivate service ────────────────────────────────────────────────────────
adminServicesRouter.delete(
  "/:id",
  requireRole("SUPER_ADMIN" as never),
  async (req, res, next) => {
    try {
      const existing = await prisma.promotionService.findUnique({ where: { id: req.params["id"] as string } });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Service not found");

      await prisma.promotionService.update({
        where: { id: req.params["id"] as string },
        data: { isActive: false },
      });
      res.json({ success: true, data: { deactivated: true } });
    } catch (err) { next(err); }
  }
);

// ── List packages for service ─────────────────────────────────────────────────
adminServicesRouter.get("/:id/packages", async (req, res, next) => {
  try {
    const packages = await prisma.servicePackage.findMany({
      where: { serviceId: req.params["id"] as string },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, name: true, description: true, quantity: true,
        priceETB: true, deliveryDaysMin: true, deliveryDaysMax: true,
        isActive: true, sortOrder: true, createdAt: true,
        _count: { select: { orders: true } },
      },
    });
    res.json({ success: true, data: packages });
  } catch (err) { next(err); }
});

// ── Create package ────────────────────────────────────────────────────────────
const packageBaseSchema = z.object({
  name:            z.string().min(1).max(200),
  description:     z.string().max(500).optional(),
  quantity:        z.number().int().min(1),
  priceETB:        z.number().int().min(1, "Price must be at least 1 cent"),
  deliveryDaysMin: z.number().int().min(1),
  deliveryDaysMax: z.number().int().min(1),
  isActive:        z.boolean().optional().default(true),
  sortOrder:       z.number().int().min(0).optional().default(0),
});

const packageSchema = packageBaseSchema.refine(d => d.deliveryDaysMax >= d.deliveryDaysMin, {
  message: "deliveryDaysMax must be >= deliveryDaysMin",
  path: ["deliveryDaysMax"],
});

adminServicesRouter.post(
  "/:id/packages",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const service = await prisma.promotionService.findUnique({ where: { id: req.params["id"] as string } });
      if (!service) throw new AppError(404, "NOT_FOUND", "Service not found");

      const parsed = packageSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid package data", parsed.error.flatten());

      const pkg = await prisma.servicePackage.create({
        data: { ...parsed.data, serviceId: req.params["id"] as string } as never,
      });
      res.status(201).json({ success: true, data: pkg });
    } catch (err) { next(err); }
  }
);

// ── Update package ────────────────────────────────────────────────────────────
const updatePackageSchema = packageBaseSchema.partial();

adminServicesRouter.patch(
  "/:serviceId/packages/:id",
  requireRole("SUPER_ADMIN" as never, "ADMIN" as never),
  async (req, res, next) => {
    try {
      const existing = await prisma.servicePackage.findFirst({
        where: { id: req.params["id"] as string, serviceId: req.params["serviceId"] as string },
      });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Package not found");

      const parsed = updatePackageSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid update data", parsed.error.flatten());

      const updated = await prisma.servicePackage.update({
        where: { id: req.params["id"] as string },
        data: parsed.data as never,
      });
      res.json({ success: true, data: updated });
    } catch (err) { next(err); }
  }
);

// ── Deactivate package ────────────────────────────────────────────────────────
adminServicesRouter.delete(
  "/:serviceId/packages/:id",
  requireRole("SUPER_ADMIN" as never),
  async (req, res, next) => {
    try {
      const existing = await prisma.servicePackage.findFirst({
        where: { id: req.params["id"] as string, serviceId: req.params["serviceId"] as string },
      });
      if (!existing) throw new AppError(404, "NOT_FOUND", "Package not found");

      await prisma.servicePackage.update({
        where: { id: req.params["id"] as string },
        data: { isActive: false },
      });
      res.json({ success: true, data: { deactivated: true } });
    } catch (err) { next(err); }
  }
);
