/**
 * Orders routes — authenticated customer endpoints
 *
 * POST /api/v1/orders               — create order
 * GET  /api/v1/orders               — list customer orders
 * GET  /api/v1/orders/:id           — get order detail
 */

import { Router, type IRouter } from "express";
import { requireCustomer } from "../middleware/auth.js";
import { AppError } from "../middleware/error.js";
import { createOrder } from "../services/order.service.js";
import { createOrderSchema } from "../validation/index.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

export const ordersRouter: IRouter = Router();

// All order routes require authentication
ordersRouter.use(requireCustomer);

// POST /api/v1/orders
ordersRouter.post("/", async (req, res, next) => {
  try {
    // Temporary diagnostic: log the raw body so we can see exactly what the frontend sends
    logger.info({ body: req.body }, "POST /orders raw body");

    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      // Log field-level detail so we can diagnose future validation failures
      // without needing a debugger attached.
      logger.warn(
        { fields: parsed.error.flatten().fieldErrors, body: { ...req.body, promoCode: req.body.promoCode ? "[redacted]" : undefined } },
        "Order creation validation failed"
      );
      throw new AppError(422, "VALIDATION_ERROR", "Invalid order data", parsed.error.flatten());
    }

    const order = await createOrder({
      userId: req.customer!.sub,
      packageId: parsed.data.packageId,
      targetUrl: parsed.data.targetUrl,
      targetType: parsed.data.targetType,
      notes: parsed.data.notes,
      promoCode: parsed.data.promoCode,
    });

    // Fire-and-forget ORDER_CREATED notification — never blocks the response
    const { sendNotification } = await import("../services/notification.service.js");
    sendNotification(req.customer!.sub, "ORDER_CREATED", {
      orderNumber: order.orderNumber,
      serviceName: order.service.name,
      amount: (order.totalAmountETB / 100).toFixed(2),
    });

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/orders
ordersRouter.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));
    const skip = (page - 1) * pageSize;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: req.customer!.sub },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          targetUrl: true,
          targetType: true,
          totalAmountETB: true,
          orderStatus: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          createdAt: true,
          completedAt: true,
          service: {
            select: {
              name: true,
              slug: true,
              platform: { select: { name: true, slug: true, iconUrl: true } },
            },
          },
          package: { select: { name: true, quantity: true } },
        },
      }),
      prisma.order.count({ where: { userId: req.customer!.sub } }),
    ]);

    res.json({
      success: true,
      data: {
        orders,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/orders/:id
ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params["id"], userId: req.customer!.sub },
      select: {
        id: true,
        orderNumber: true,
        targetUrl: true,
        targetType: true,
        quantity: true,
        unitPriceETB: true,
        totalAmountETB: true,
        orderStatus: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        service: {
          select: {
            id: true,
            name: true,
            slug: true,
            targetLabel: true,
            platform: { select: { name: true, slug: true, iconUrl: true } },
          },
        },
        package: {
          select: {
            id: true,
            name: true,
            quantity: true,
            priceETB: true,
            deliveryDaysMin: true,
            deliveryDaysMax: true,
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            amountETB: true,
            reference: true,
            screenshotUrl: true,
            createdAt: true,
            rejectionReason: true,
          },
        },
        reports: {
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          take: 1,
          select: { id: true, title: true, publishedAt: true },
        },
      },
    });

    if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/orders/:id/cancel
// Only orders in PENDING_PAYMENT status can be cancelled by the customer.
ordersRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params["id"], userId: req.customer!.sub },
      select: { id: true, orderNumber: true, orderStatus: true },
    });

    if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");

    // Only PENDING_PAYMENT is cancellable by the customer
    if (order.orderStatus !== "PENDING_PAYMENT") {
      throw new AppError(
        409,
        "CANNOT_CANCEL",
        `Orders with status ${order.orderStatus} cannot be cancelled. Only orders awaiting payment can be cancelled.`
      );
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        orderStatus: "CANCELLED",
        fulfillmentStatus: "CANCELLED",
      },
    });

    // Write audit log
    const { writeAuditLog } = await import("../services/audit.service.js");
    await writeAuditLog({
      actorId: req.customer!.sub,
      actorType: "CUSTOMER" as never,
      action: "ORDER_CANCELLED",
      entityType: "Order",
      entityId: order.id,
      before: { orderStatus: order.orderStatus },
      after: { orderStatus: "CANCELLED" },
      orderId: order.id,
      ipAddress: req.ip as string | undefined,
    });

    // Notify customer via Telegram
    const { sendNotification } = await import("../services/notification.service.js");
    await sendNotification(req.customer!.sub, "ORDER_CANCELLED", {
      orderNumber: order.orderNumber,
      reason: "Cancelled by customer",
    });

    res.json({ success: true, data: { id: order.id, orderStatus: "CANCELLED" } });
  } catch (err) {
    next(err);
  }
});



