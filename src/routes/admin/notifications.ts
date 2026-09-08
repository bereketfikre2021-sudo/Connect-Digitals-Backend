/**
 * Admin notification routes
 *
 * GET   /api/v1/admin/notifications          — list all notifications (all users, newest first)
 * GET   /api/v1/admin/notifications/unread   — unread count across all users
 * PATCH /api/v1/admin/notifications/read-all — mark all admin-visible as read (own admin record)
 */

import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { prisma } from "../../lib/prisma.js";

export const adminNotificationsRouter: IRouter = Router();
adminNotificationsRouter.use(requireAdmin);

// GET /api/v1/admin/notifications
// Returns recent notifications across all users so admin can see what customers received
adminNotificationsRouter.get("/", async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt((req.query["page"]     as string) ?? "1",  10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "30", 10)));
    const event    = req.query["event"] as string | undefined;
    const unread   = req.query["unread"] === "true";

    const where = {
      ...(event ? { event: event as never } : {}),
      ...(unread ? { readAt: null } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, event: true, title: true, message: true,
          sentAt: true, failedAt: true, readAt: true, createdAt: true,
          user: {
            select: {
              id: true, firstName: true, lastName: true, username: true,
              telegramIdentity: { select: { telegramUserId: true } },
            },
          },
        },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { readAt: null } }),
    ]);

    res.json({
      success: true,
      data: { notifications, total, unreadCount, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (err) { next(err); }
});

// GET /api/v1/admin/notifications/unread — lightweight unread count for badge
adminNotificationsRouter.get("/unread", async (_req, res, next) => {
  try {
    const unreadCount = await prisma.notification.count({ where: { readAt: null } });
    res.json({ success: true, data: { unreadCount } });
  } catch (err) { next(err); }
});

// PATCH /api/v1/admin/notifications/read-all — mark all unread notifications as read
adminNotificationsRouter.patch("/read-all", async (_req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { readAt: null },
      data:  { readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// PATCH /api/v1/admin/notifications/:id/read — mark a single notification as read
adminNotificationsRouter.patch("/:id/read", async (req, res, next) => {
  try {
    await prisma.notification.update({
      where: { id: req.params["id"] as string },
      data:  { readAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});
