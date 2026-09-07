/**
 * Reports routes — authenticated customer endpoints
 *
 * GET /api/v1/reports      — list published reports for the authenticated customer
 * GET /api/v1/reports/:id  — published report detail (customer must own the order)
 */

import { Router, type IRouter } from "express";
import { requireCustomer } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { prisma } from "../lib/prisma.js";

export const reportsRouter: IRouter = Router();
reportsRouter.use(requireCustomer);

// GET /api/v1/reports — list all published reports for this customer
reportsRouter.get("/", async (req, res, next) => {
  try {
    const reports = await prisma.report.findMany({
      where: {
        status: "PUBLISHED",
        order: { userId: req.customer!.sub },
      },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        publishedAt: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            service: { select: { name: true, platform: { select: { name: true } } } },
            package: { select: { name: true, quantity: true } },
          },
        },
      },
    });

    res.json({ success: true, data: { reports } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/reports/:id — full published report detail
reportsRouter.get("/:id", async (req, res, next) => {
  try {
    const report = await prisma.report.findFirst({
      where: {
        id: req.params["id"],
        status: "PUBLISHED",
        order: { userId: req.customer!.sub },
      },
      select: {
        id: true,
        title: true,
        periodStart: true,
        periodEnd: true,
        summary: true,
        fileUrl: true,
        status: true,
        publishedAt: true,
        createdAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            targetUrl: true,
            totalAmountETB: true,
            orderStatus: true,
            service: { select: { name: true, platform: { select: { name: true } } } },
            package: { select: { name: true, quantity: true } },
          },
        },
        campaign: {
          select: {
            id: true,
            targetUrl: true,
            startDate: true,
            endDate: true,
            internalStatus: true,
            metrics: {
              orderBy: { date: "desc" },
              select: {
                date: true,
                source: true,
                impressions: true,
                reach: true,
                clicks: true,
                videoViews: true,
                likes: true,
                comments: true,
                shares: true,
                engagement: true,
                conversions: true,
                spendETB: true,
              },
            },
          },
        },
      },
    });

    if (!report) throw new AppError(404, "NOT_FOUND", "Report not found or not yet published");
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});
