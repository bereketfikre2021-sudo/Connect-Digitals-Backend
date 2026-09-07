/**
 * Admin audit log routes
 *
 * GET /api/v1/admin/audit-logs  — paginated audit trail
 */

import { Router, type IRouter } from "express";
import { requireAdmin } from "../../middleware/admin-auth.js";
import { prisma } from "../../lib/prisma.js";

export const adminAuditLogsRouter: IRouter = Router();
adminAuditLogsRouter.use(requireAdmin);

adminAuditLogsRouter.get("/", async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt((req.query["page"]     as string) ?? "1",  10));
    const pageSize = Math.min(50, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "30", 10)));
    const action   = req.query["action"]   as string | undefined;
    const actorId  = req.query["actorId"]  as string | undefined;
    const orderId  = req.query["orderId"]  as string | undefined;
    const search   = (req.query["search"]  as string | undefined)?.trim();

    const where: Record<string, unknown> = {};
    if (action)  where["action"]  = { contains: action,  mode: "insensitive" };
    if (actorId) where["actorId"] = actorId;
    if (orderId) where["orderId"] = orderId;
    if (search)  where["OR"] = [
      { action:     { contains: search, mode: "insensitive" } },
      { entityType: { contains: search, mode: "insensitive" } },
      { entityId:   { contains: search, mode: "insensitive" } },
    ];

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where:   where as never,
        orderBy: { createdAt: "desc" },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, action: true, actorType: true, actorId: true,
          entityType: true, entityId: true,
          before: true, after: true,
          orderId: true, ipAddress: true, createdAt: true,
          adminActor:    { select: { firstName: true, lastName: true, email: true } },
          customerActor: { select: { firstName: true, lastName: true, username: true } },
        },
      }),
      prisma.auditLog.count({ where: where as never }),
    ]);

    res.json({ success: true, data: { logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
  } catch (err) { next(err); }
});
