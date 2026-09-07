/**
 * Audit log service.
 * Write immutable audit entries for all sensitive financial and admin actions.
 * Never throw — audit failures must not break business operations.
 */

import { prisma } from "../lib/prisma.js";
import type { AuditActorType } from "../shared/index.js";
import { logger } from "../lib/logger.js";

export interface AuditParams {
  actorId?: string;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  orderId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        actorType: params.actorType,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        before: params.before as never,
        after: params.after as never,
        orderId: params.orderId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (err) {
    logger.error({ err, params }, "Failed to write audit log — continuing");
  }
}


