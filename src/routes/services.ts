/**
 * Services routes — public catalogue (no auth required)
 *
 * GET /api/v1/services/platforms          — all active platforms
 * GET /api/v1/services/platforms/:slug    — platform with its services
 * GET /api/v1/services                    — all active services (with platform)
 * GET /api/v1/services/:slug              — single service with packages
 */

import { Router, type IRouter } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";

export const servicesRouter: IRouter = Router();

// GET /api/v1/services/platforms
servicesRouter.get("/platforms", async (_req, res, next) => {
  try {
    const platforms = await prisma.platform.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        sortOrder: true,
        _count: { select: { services: { where: { isActive: true } } } },
      },
    });
    res.json({ success: true, data: platforms });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/services/platforms/:slug
servicesRouter.get("/platforms/:slug", async (req, res, next) => {
  try {
    const platform = await prisma.platform.findUnique({
      where: { slug: req.params["slug"] },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        services: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            slug: true,
            shortDescription: true,
            targetType: true,
            targetLabel: true,
            fulfillmentType: true,
            sortOrder: true,
            _count: { select: { packages: { where: { isActive: true } } } },
          },
        },
      },
    });

    if (!platform) throw new AppError(404, "NOT_FOUND", "Platform not found");
    res.json({ success: true, data: platform });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/services
servicesRouter.get("/", async (_req, res, next) => {
  try {
    const services = await prisma.promotionService.findMany({
      where: { isActive: true },
      orderBy: [{ platform: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        shortDescription: true,
        targetType: true,
        targetLabel: true,
        fulfillmentType: true,
        sortOrder: true,
        platform: { select: { id: true, name: true, slug: true, iconUrl: true } },
      },
    });
    res.json({ success: true, data: services });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/services/:slug
servicesRouter.get("/:slug", async (req, res, next) => {
  try {
    const service = await prisma.promotionService.findFirst({
      where: { slug: req.params["slug"], isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        shortDescription: true,
        targetType: true,
        targetLabel: true,
        targetPlaceholder: true,
        targetHelpText: true,
        requiresTargetUrl: true,
        campaignRequirements: true,
        fulfillmentType: true,
        sortOrder: true,
        platform: { select: { id: true, name: true, slug: true, iconUrl: true } },
        packages: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            quantity: true,
            priceETB: true,
            deliveryDaysMin: true,
            deliveryDaysMax: true,
            sortOrder: true,
          },
        },
      },
    });

    if (!service || !service.platform) {
      throw new AppError(404, "NOT_FOUND", "Service not found");
    }

    res.json({ success: true, data: service });
  } catch (err) {
    next(err);
  }
});


