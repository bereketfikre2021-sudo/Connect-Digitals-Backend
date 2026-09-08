/**
 * Fulfillment service — task creation and status transitions.
 *
 * Status transitions are validated against the shared state machine.
 * For non-MANUAL fulfillment types, the provider adapter is invoked
 * when the task transitions to PROCESSING (i.e. admin has approved).
 * All changes are audited.
 *
 * Phase 8C addition:
 * When a task transitions to COMPLETED, a DRAFT Report is automatically
 * created for the order so admins can edit and publish it to the customer.
 * Report creation is idempotent — it is skipped if a non-ARCHIVED report
 * already exists for the same order.  Failure to create the draft report is
 * logged but never throws: it must not fail an otherwise-successful fulfillment.
 */

import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";
import { writeAuditLog } from "./audit.service.js";
import { sendNotification } from "./notification.service.js";
import { getProvider, requiresProvider } from "../providers/index.js";
import { ProviderError } from "../providers/types.js";
import { logger } from "../lib/logger.js";
import {
  FULFILLMENT_TRANSITIONS,
  assertValidTransition,
  type FulfillmentStatus,
  type FulfillmentType,
  type AuditActorType,
} from "../shared/index.js";

// ── Auto draft-report helper ──────────────────────────────────────────────────
/**
 * Creates a DRAFT Report for the completed order, unless one already exists.
 *
 * Rules:
 * - Skip silently if ANY non-ARCHIVED report already exists for this orderId
 *   (prevents duplicates when an admin already created one manually).
 * - Never auto-publish — only admins may publish via the admin panel.
 * - Attach the Campaign record if one exists for the order.
 * - Failure is non-fatal: logged as an error, never re-thrown.
 *
 * @returns "created" | "exists" | "skipped" for observability in tests
 */
export async function createDraftReportForOrder(
  orderId: string,
  orderNumber: string,
  serviceName: string,
): Promise<"created" | "exists" | "skipped"> {
  try {
    // Idempotency check — any active (non-ARCHIVED) report blocks creation
    const existing = await prisma.report.findFirst({
      where: { orderId, status: { not: "ARCHIVED" } },
      select: { id: true },
    });
    if (existing) {
      logger.info({ orderId, reportId: existing.id }, "Draft report already exists for completed order — skipping");
      return "exists";
    }

    // Attach campaign if one exists
    const campaign = await prisma.campaign.findUnique({
      where: { orderId },
      select: { id: true },
    });

    await prisma.report.create({
      data: {
        orderId,
        campaignId:  campaign?.id ?? null,
        title:       `${serviceName} — Order ${orderNumber}`,
        status:      "DRAFT",
        generatedAt: new Date(),
      },
    });

    logger.info({ orderId, orderNumber }, "Auto-created draft report for completed order");
    return "created";
  } catch (err) {
    // Non-fatal — log and continue. The fulfillment completion must not be
    // rolled back because the report creation failed.
    logger.error({ err, orderId }, "Failed to auto-create draft report for completed order");
    return "skipped";
  }
}

export async function createFulfillmentTask(
  orderId: string,
  fulfillmentType: FulfillmentType
) {
  // Idempotent — if a task already exists for this order, return it
  const existing = await prisma.fulfillmentTask.findUnique({ where: { orderId } });
  if (existing) return existing;

  const task = await prisma.fulfillmentTask.create({
    data: {
      orderId,
      fulfillmentType,
      status: "PENDING",
      requiresApproval: false,
    },
  });

  // Advance order status to PROCESSING
  await prisma.order.update({
    where: { id: orderId },
    data: { orderStatus: "PROCESSING", fulfillmentStatus: "PENDING" },
  });

  return task;
}

export async function updateFulfillmentStatus(
  taskId: string,
  newStatus: FulfillmentStatus,
  adminId: string,
  options?: { assignedTo?: string; providerReference?: string; errorMessage?: string; notes?: string }
) {
  const task = await prisma.fulfillmentTask.findUnique({
    where: { id: taskId },
    include: {
      order: {
        select: {
          id: true, orderNumber: true, userId: true,
          service: { select: { name: true } },
          package: { select: { deliveryDaysMin: true, deliveryDaysMax: true } },
        },
      },
    },
  });

  if (!task) throw new AppError(404, "NOT_FOUND", "Fulfillment task not found");

  // Validate transition using shared state machine
  // assertValidTransition throws a plain Error — convert to AppError(409) so the
  // error handler returns a proper 409 instead of falling through to 500.
  try {
    assertValidTransition(
      FULFILLMENT_TRANSITIONS,
      task.status as FulfillmentStatus,
      newStatus,
      "FulfillmentTask"
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new AppError(409, "INVALID_TRANSITION", msg);
  }

  const now = new Date();
  const updateData: Record<string, unknown> = {
    status: newStatus,
    ...(options?.assignedTo && { assignedTo: options.assignedTo }),
    ...(options?.providerReference && { providerReference: options.providerReference }),
    ...(options?.errorMessage && { errorMessage: options.errorMessage }),
    ...(newStatus === "PROCESSING" && !task.startedAt ? { startedAt: now } : {}),
    ...(newStatus === "COMPLETED" ? { completedAt: now } : {}),
  };

  await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    await tx.fulfillmentTask.update({ where: { id: taskId }, data: updateData as never });

    // Map fulfillment status to order fulfillment status
    const orderFulfillmentStatus = newStatus;
    const orderStatusMap: Partial<Record<FulfillmentStatus, string>> = {
      PROCESSING: "IN_PROGRESS",
      COMPLETED: "COMPLETED",
      FAILED: "IN_PROGRESS",
      CANCELLED: "CANCELLED",
    };
    const newOrderStatus = orderStatusMap[newStatus];

    if (newOrderStatus) {
      await tx.order.update({
        where: { id: task.orderId },
        data: {
          fulfillmentStatus: orderFulfillmentStatus,
          ...(newOrderStatus ? { orderStatus: newOrderStatus as never } : {}),
          ...(newStatus === "COMPLETED" ? { completedAt: now } : {}),
        },
      });
    } else {
      await tx.order.update({
        where: { id: task.orderId },
        data: { fulfillmentStatus: orderFulfillmentStatus },
      });
    }
  });

  await writeAuditLog({
    actorId: adminId,
    actorType: "ADMIN" as AuditActorType,
    action: "FULFILLMENT_STATUS_CHANGED",
    entityType: "FulfillmentTask",
    entityId: taskId,
    before: { status: task.status },
    after: { status: newStatus },
    orderId: task.orderId,
  });

  // ── Provider adapter invocation ────────────────────────────────────────────
  // For non-MANUAL fulfillment types, call the provider adapter when
  // transitioning to PROCESSING. The DB transaction has already committed —
  // provider failure is logged and recorded but does NOT roll back the status
  // change. Admin can manually intervene via the dashboard.
  //
  // APPROVAL GATE: This function is only called after admin approval
  // (the admin explicitly triggers the status change in the dashboard).
  // No automatic spending ever occurs.
  if (newStatus === "PROCESSING" && requiresProvider(task.fulfillmentType)) {
    const provider = getProvider(task.fulfillmentType);
    if (provider && task.order) {
      // Look up the campaign record for this order (may not exist for all orders)
      const campaign = await prisma.campaign.findUnique({
        where: { orderId: task.orderId },
        select: {
          id: true, targetUrl: true, objective: true,
          budgetETB: true, dailyBudgetETB: true,
          durationDays: true, startDate: true, endDate: true,
        },
      });

      if (campaign) {
        // Use dryRun=false only when the provider is fully configured.
        // The adapter's isConfigured check guards real spending.
        // dryRun=true is always safe — no money spent.
        const validation = await provider.validateCampaign({
          campaignId:    campaign.id,
          targetUrl:     campaign.targetUrl,
          objective:     campaign.objective ?? task.order.service.name,
          budgetETB:     campaign.budgetETB ?? 0,
          dryRun:        true,                       // validation never costs money
          idempotencyKey: `fulfillment-${taskId}`,
        });

        if (!validation.valid) {
          logger.warn({ campaignId: campaign.id, errors: validation.errors, taskId }, "Campaign validation failed during fulfillment transition — skipping provider call");
        }

        // Determine whether to attempt a real launch
        // dryRun=false only if budget is set and provider is configured (adapter decides)
        const shouldDryRun = !campaign.budgetETB || campaign.budgetETB <= 0 || !validation.valid;

        const config = {
          campaignId:      campaign.id,
          targetUrl:       campaign.targetUrl,
          objective:       campaign.objective ?? task.order.service.name,
          budgetETB:       campaign.budgetETB ?? 0,
          dailyBudgetETB:  campaign.dailyBudgetETB ?? undefined,
          durationDays:    campaign.durationDays ?? undefined,
          startDate:       campaign.startDate?.toISOString(),
          endDate:         campaign.endDate?.toISOString(),
          dryRun:          shouldDryRun,
          idempotencyKey:  `fulfillment-${taskId}`,
        };

        try {
          const result = await provider.createCampaign(config);
          logger.info({ provider: provider.name, campaignId: campaign.id, providerCampaignId: result.providerCampaignId, dryRun: result.dryRun }, "Provider campaign create completed");

          // Persist the provider reference (dry-run ID stored for audit trail)
          await prisma.campaign.update({
            where: { id: campaign.id },
            data: { providerCampaignId: result.providerCampaignId },
          });
        } catch (err) {
          // Provider failure is non-fatal — log and record but don't throw
          const msg = err instanceof ProviderError ? err.message : String(err);
          logger.error({ err, provider: provider.name, campaignId: campaign.id, taskId }, "Provider campaign creation failed");
          await prisma.fulfillmentTask.update({
            where: { id: taskId },
            data: { errorMessage: `Provider error: ${msg}` },
          });
        }
      } else {
        logger.warn({ taskId, fulfillmentType: task.fulfillmentType }, "No campaign record found for provider fulfillment — skipping provider call");
      }
    }
  }

  // Send notifications for key transitions
  if (task.order) {
    if (newStatus === "PROCESSING") {
      sendNotification(task.order.userId, "FULFILLMENT_STARTED", {
        orderNumber: task.order.orderNumber,
        serviceName: task.order.service.name,
        deliveryDays: `${task.order.package.deliveryDaysMin}–${task.order.package.deliveryDaysMax}`,
      });
    }
    if (newStatus === "COMPLETED") {
      // 1. Notify customer (non-fatal — sendNotification never throws)
      sendNotification(task.order.userId, "ORDER_COMPLETED", {
        orderNumber: task.order.orderNumber,
        serviceName: task.order.service.name,
      });

      // 2. Auto-create a DRAFT report for the admin to review and publish.
      await createDraftReportForOrder(
        task.orderId,
        task.order.orderNumber,
        task.order.service.name,
      );

      // 3. Cashback reward — 2% of order total credited to wallet (non-fatal)
      try {
        const orderFull = await prisma.order.findUnique({
          where: { id: task.orderId },
          select: { totalAmountETB: true, orderNumber: true },
        });
        if (orderFull && orderFull.totalAmountETB > 0) {
          const cashbackAmount = Math.floor(orderFull.totalAmountETB * 0.02); // 2%
          if (cashbackAmount > 0) {
            const { creditWallet } = await import("./wallet.service.js");
            // Use a deterministic synthetic paymentId so the reward is idempotent
            const cashbackId = `cashback-${task.orderId}`;
            await creditWallet({
              userId:      task.order.userId,
              amountETB:   cashbackAmount,
              paymentId:   cashbackId,
              description: `2% cashback reward for order ${orderFull.orderNumber}`,
              actorId:     adminId,
            });
            logger.info({ orderId: task.orderId, cashbackAmount }, "Cashback reward credited");
          }
        }
      } catch (cashbackErr) {
        // Non-fatal — log but never fail the completion
        logger.error({ err: cashbackErr, orderId: task.orderId }, "Failed to credit cashback reward");
      }
    }
  }

  return { success: true };
}



