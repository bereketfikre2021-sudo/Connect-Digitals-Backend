/**
 * Customer notifications routes
 *
 * GET   /api/v1/notifications        — list notifications (newest first, paginated)
 * PATCH /api/v1/notifications/read-all — mark all as read
 * PATCH /api/v1/notifications/:id/read — mark one as read
 */

import { Router, type IRouter } from "express";
import { requireCustomer } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

export const notificationsRouter: IRouter = Router();
notificationsRouter.use(requireCustomer);

notificationsRouter.get("/", async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt((req.query["page"]     as string) ?? "1",  10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "20", 10)));

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where:   { userId: req.customer!.sub },
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, event: true, title: true, message: true,
          metadata: true, readAt: true, sentAt: true, createdAt: true,
        },
      }),
      prisma.notification.count({ where: { userId: req.customer!.sub } }),
      prisma.notification.count({ where: { userId: req.customer!.sub, readAt: null } }),
    ]);

    res.json({ success: true, data: { notifications, total, unreadCount, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) { next(err); }
});

notificationsRouter.patch("/read-all", async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.customer!.sub, readAt: null },
      data:  { readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

notificationsRouter.patch("/:id/read", async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { id: req.params["id"], userId: req.customer!.sub, readAt: null },
      data:  { readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});
