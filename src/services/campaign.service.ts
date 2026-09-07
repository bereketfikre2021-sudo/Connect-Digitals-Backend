/**
 * Campaign service — Phase 7
 *
 * Encapsulates all provider-touching campaign operations.
 * Called by admin routes and the fulfillment engine.
 *
 * SAFETY RULES (enforced here, not in adapters):
 * 1. Budget never exceeds the order's totalAmountETB.
 * 2. Admin approval is required before any real provider call (dryRun=false).
 * 3. Duplicate launches are blocked — idempotency enforced via providerCampaignId.
 * 4. Provider errors are stored safely; sensitive details are never forwarded to customers.
 * 5. Every state change is audited.
 */

import { prisma } from "../lib/prisma.js";
import { AppError } from "../middleware/error.js";
import { writeAuditLog } from "./audit.service.js";
import { sendNotification } from "./notification.service.js";
import { getProvider, requiresProvider } from "../providers/index.js";
import { ProviderError, ProviderNotConfiguredError } from "../providers/types.js";
import type { CampaignConfig } from "../providers/types.js";
import { logger } from "../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LaunchOptions {
  adminId: string;
  /** When true: validate and simulate without calling the provider */
  dryRun?: boolean;
}

export interface OverrideOptions {
  adminId: string;
}

export interface SyncMetricsOptions {
  adminId: string;
}

export interface GenerateReportOptions {
  adminId: string;
  title?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitise a provider error message before storing or returning to the frontend.
 *  Strips anything that looks like an access token or secret. */
function sanitiseError(message: string): string {
  return message
    .replace(/[\w-]{30,}/g, (match) => {
      // Preserve recognisable non-secret substrings; redact anything long and opaque
      if (/^[A-Z_]+$/.test(match)) return match; // UPPER_CASE constants are fine
      return "[REDACTED]";
    })
    .slice(0, 500);
}

async function loadCampaignFull(campaignId: string) {
  return prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      internalStatus: true,
      provider: true,
      providerCampaignId: true,
      targetUrl: true,
      objective: true,
      budgetETB: true,
      dailyBudgetETB: true,
      durationDays: true,
      startDate: true,
      endDate: true,
      fulfillmentTaskId: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          userId: true,
          totalAmountETB: true,
          service: {
            select: {
              name: true,
              fulfillmentType: true,
            },
          },
        },
      },
      fulfillmentTask: {
        select: { id: true, fulfillmentType: true },
      },
      metrics: {
        orderBy: { date: "desc" },
        take: 1,
        select: {
          date: true, source: true,
          impressions: true, reach: true, clicks: true, videoViews: true,
          likes: true, comments: true, shares: true, engagement: true,
          conversions: true, spendETB: true,
        },
      },
    },
  });
}

function buildConfig(
  campaign: NonNullable<Awaited<ReturnType<typeof loadCampaignFull>>>,
  taskId: string,
  dryRun: boolean
): CampaignConfig {
  return {
    campaignId:           campaign.id,
    providerCampaignId:   campaign.providerCampaignId ?? undefined,
    targetUrl:            campaign.targetUrl,
    objective:            campaign.objective ?? campaign.order.service.name,
    budgetETB:            campaign.budgetETB ?? 0,
    dailyBudgetETB:       campaign.dailyBudgetETB ?? undefined,
    durationDays:         campaign.durationDays ?? undefined,
    startDate:            campaign.startDate?.toISOString(),
    endDate:              campaign.endDate?.toISOString(),
    dryRun,
    idempotencyKey:       `campaign-${campaign.id}-task-${taskId}`,
  };
}

// ─── Launch ───────────────────────────────────────────────────────────────────

/**
 * Launch a campaign on the advertising provider.
 *
 * Safety checks enforced before any provider call:
 * - Campaign must exist and be in DRAFT or PENDING status.
 * - Provider must be recognised and configured (unless dryRun).
 * - Budget must not exceed the order's totalAmountETB.
 * - Duplicate launches are blocked if providerCampaignId already set.
 */
export async function launchCampaign(
  campaignId: string,
  { adminId, dryRun = false }: LaunchOptions
): Promise<{ providerCampaignId: string; dryRun: boolean }> {
  const campaign = await loadCampaignFull(campaignId);
  if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found");

  // Duplicate launch protection
  if (campaign.providerCampaignId && !dryRun) {
    throw new AppError(409, "ALREADY_LAUNCHED", `Campaign is already registered with provider (${campaign.providerCampaignId})`);
  }

  // Status guard — only DRAFT or PENDING can be launched
  if (!["DRAFT", "PENDING"].includes(campaign.internalStatus)) {
    throw new AppError(409, "INVALID_STATUS", `Campaign cannot be launched from status ${campaign.internalStatus}`);
  }

  // Budget safety: campaign budget must not exceed order total
  if (campaign.budgetETB && campaign.budgetETB > campaign.order.totalAmountETB) {
    throw new AppError(400, "BUDGET_EXCEEDS_ORDER",
      `Campaign budget (${campaign.budgetETB}) exceeds order total (${campaign.order.totalAmountETB}). Reduce the budget before launching.`);
  }
  if (!campaign.budgetETB || campaign.budgetETB <= 0) {
    throw new AppError(400, "MISSING_BUDGET", "Campaign budget must be set before launching");
  }
  if (!campaign.targetUrl) {
    throw new AppError(400, "MISSING_TARGET_URL", "Campaign target URL is required");
  }

  // Fulfillment type determines the provider
  const fulfillmentType = campaign.fulfillmentTask?.fulfillmentType ?? campaign.order.service.fulfillmentType;
  if (!requiresProvider(fulfillmentType)) {
    throw new AppError(400, "MANUAL_FULFILLMENT", "This campaign uses manual fulfillment — no provider launch needed");
  }

  const provider = getProvider(fulfillmentType);
  if (!provider) throw new AppError(500, "PROVIDER_UNKNOWN", `No provider adapter for fulfillment type: ${fulfillmentType}`);

  const config = buildConfig(campaign, campaign.fulfillmentTaskId, dryRun);

  // Validate before calling the provider
  const validation = await provider.validateCampaign(config);
  if (!validation.valid) {
    throw new AppError(422, "CAMPAIGN_VALIDATION_FAILED",
      `Campaign validation failed: ${validation.errors.join("; ")}`);
  }

  let providerCampaignId: string;

  try {
    const result = await provider.createCampaign(config);
    providerCampaignId = result.providerCampaignId;
    logger.info({ campaignId, providerCampaignId, provider: provider.name, dryRun }, "Campaign launched");
  } catch (err) {
    const safe = sanitiseError(err instanceof ProviderError ? err.message : String(err));
    const retryable = err instanceof ProviderError ? err.retryable : false;
    logger.error({ err, campaignId, provider: provider.name }, "Campaign launch failed");

    // Mark campaign as FAILED and store sanitised error
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { internalStatus: "FAILED" },
    });

    await writeAuditLog({
      actorId:    adminId,
      actorType:  "ADMIN" as never,
      action:     "CAMPAIGN_LAUNCH_FAILED",
      entityType: "Campaign",
      entityId:   campaignId,
      after:      { error: safe, retryable },
      orderId:    campaign.order.id,
    });

    // Notify admin (via system pattern — no customer notification for provider errors)
    throw new AppError(502, "PROVIDER_ERROR", `Campaign launch failed: ${safe}`);
  }

  // Persist provider reference and advance status to PENDING (awaiting provider approval)
  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      providerCampaignId,
      internalStatus: ("PENDING" as never),
      ...(dryRun ? {} : { startDate: campaign.startDate ?? new Date() }),
    },
  });

  await writeAuditLog({
    actorId:    adminId,
    actorType:  "ADMIN" as never,
    action:     "CAMPAIGN_LAUNCHED",
    entityType: "Campaign",
    entityId:   campaignId,
    before:     { internalStatus: campaign.internalStatus },
    after:      { internalStatus: "PENDING", providerCampaignId, dryRun },
    orderId:    campaign.order.id,
  });

  return { providerCampaignId, dryRun };
}

// ─── Admin overrides ──────────────────────────────────────────────────────────

async function getProviderConfig(
  campaignId: string,
  requireProviderRef = true
): Promise<{ campaign: NonNullable<Awaited<ReturnType<typeof loadCampaignFull>>>; provider: NonNullable<ReturnType<typeof getProvider>>; config: CampaignConfig }> {
  const campaign = await loadCampaignFull(campaignId);
  if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found");

  if (requireProviderRef && !campaign.providerCampaignId) {
    throw new AppError(409, "NOT_LAUNCHED", "Campaign has not been launched yet — no provider reference exists");
  }

  const fulfillmentType = campaign.fulfillmentTask?.fulfillmentType ?? campaign.order.service.fulfillmentType;
  const provider = getProvider(fulfillmentType);
  if (!provider) throw new AppError(400, "MANUAL_FULFILLMENT", "This campaign uses manual fulfillment");

  const config = buildConfig(campaign, campaign.fulfillmentTaskId, false);
  return { campaign, provider, config };
}

export async function pauseCampaign(campaignId: string, { adminId }: OverrideOptions): Promise<void> {
  const { campaign, provider, config } = await getProviderConfig(campaignId);
  if (!["ACTIVE"].includes(campaign.internalStatus)) {
    throw new AppError(409, "INVALID_STATUS", `Cannot pause campaign in status ${campaign.internalStatus}`);
  }

  try {
    await provider.pauseCampaign(config);
  } catch (err) {
    throw new AppError(502, "PROVIDER_ERROR", sanitiseError(err instanceof ProviderError ? err.message : String(err)));
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: { internalStatus: "PAUSED" } });
  await writeAuditLog({ actorId: adminId, actorType: "ADMIN" as never, action: "CAMPAIGN_PAUSED", entityType: "Campaign", entityId: campaignId, before: { internalStatus: campaign.internalStatus }, after: { internalStatus: "PAUSED" }, orderId: campaign.order.id });
}

export async function resumeCampaign(campaignId: string, { adminId }: OverrideOptions): Promise<void> {
  const { campaign, provider, config } = await getProviderConfig(campaignId);
  if (!["PAUSED"].includes(campaign.internalStatus)) {
    throw new AppError(409, "INVALID_STATUS", `Cannot resume campaign in status ${campaign.internalStatus}`);
  }

  try {
    await provider.resumeCampaign(config);
  } catch (err) {
    throw new AppError(502, "PROVIDER_ERROR", sanitiseError(err instanceof ProviderError ? err.message : String(err)));
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: { internalStatus: "ACTIVE" } });
  await writeAuditLog({ actorId: adminId, actorType: "ADMIN" as never, action: "CAMPAIGN_RESUMED", entityType: "Campaign", entityId: campaignId, before: { internalStatus: campaign.internalStatus }, after: { internalStatus: "ACTIVE" }, orderId: campaign.order.id });

  await sendNotification(campaign.order.userId, "FULFILLMENT_STARTED", {
    orderNumber: campaign.order.orderNumber,
    serviceName: campaign.order.service.name,
    deliveryDays: "see your campaign details",
  });
}

export async function cancelCampaignViaProvider(campaignId: string, { adminId }: OverrideOptions): Promise<void> {
  const { campaign, provider, config } = await getProviderConfig(campaignId, false);
  if (["CANCELLED", "COMPLETED"].includes(campaign.internalStatus)) {
    throw new AppError(409, "INVALID_STATUS", `Campaign is already ${campaign.internalStatus}`);
  }

  if (campaign.providerCampaignId) {
    try {
      await provider.cancelCampaign(config);
    } catch (err) {
      throw new AppError(502, "PROVIDER_ERROR", sanitiseError(err instanceof ProviderError ? err.message : String(err)));
    }
  }

  const now = new Date();
  await prisma.campaign.update({ where: { id: campaignId }, data: { internalStatus: "CANCELLED", endDate: now } });
  await writeAuditLog({ actorId: adminId, actorType: "ADMIN" as never, action: "CAMPAIGN_CANCELLED", entityType: "Campaign", entityId: campaignId, before: { internalStatus: campaign.internalStatus }, after: { internalStatus: "CANCELLED" }, orderId: campaign.order.id });
}

export async function retryCampaign(campaignId: string, { adminId }: OverrideOptions): Promise<{ providerCampaignId: string; dryRun: boolean }> {
  const campaign = await loadCampaignFull(campaignId);
  if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found");
  if (campaign.internalStatus !== "FAILED") {
    throw new AppError(409, "INVALID_STATUS", `Campaign retry only allowed from FAILED status (current: ${campaign.internalStatus})`);
  }

  // Reset to DRAFT to allow re-launch, clear provider ref so duplicate check passes
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { internalStatus: "DRAFT", providerCampaignId: null },
  });

  await writeAuditLog({ actorId: adminId, actorType: "ADMIN" as never, action: "CAMPAIGN_RETRY_INITIATED", entityType: "Campaign", entityId: campaignId, before: { internalStatus: "FAILED" }, after: { internalStatus: "DRAFT" }, orderId: campaign.order.id });

  // Re-launch with dryRun=false — provider configured check is inside launchCampaign
  return launchCampaign(campaignId, { adminId, dryRun: false });
}

// ─── Sync metrics ─────────────────────────────────────────────────────────────

/**
 * Pull latest metrics from the provider and store them as a PROVIDER_API snapshot.
 * Only runs for campaigns with a providerCampaignId and ACTIVE/PAUSED status.
 */
export async function syncCampaignMetrics(
  campaignId: string,
  { adminId }: SyncMetricsOptions
): Promise<{ stored: boolean; metrics: Record<string, number | null> }> {
  const { campaign, provider, config } = await getProviderConfig(campaignId);

  if (!["ACTIVE", "PAUSED", "COMPLETED"].includes(campaign.internalStatus)) {
    throw new AppError(409, "INVALID_STATUS", `Cannot sync metrics for campaign in status ${campaign.internalStatus}`);
  }

  let rawMetrics;
  try {
    rawMetrics = await provider.getCampaignMetrics(config);
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      throw new AppError(503, "PROVIDER_NOT_CONFIGURED", "Provider credentials are not configured — metrics cannot be fetched");
    }
    throw new AppError(502, "PROVIDER_ERROR", sanitiseError(err instanceof ProviderError ? err.message : String(err)));
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  await prisma.campaignMetric.upsert({
    where: { campaignId_date_source: { campaignId, date: today, source: "PROVIDER_API" } },
    update: {
      impressions: rawMetrics.impressions ?? undefined,
      reach:       rawMetrics.reach       ?? undefined,
      clicks:      rawMetrics.clicks      ?? undefined,
      videoViews:  rawMetrics.videoViews  ?? undefined,
      likes:       rawMetrics.likes       ?? undefined,
      comments:    rawMetrics.comments    ?? undefined,
      shares:      rawMetrics.shares      ?? undefined,
      engagement:  rawMetrics.engagement  ?? undefined,
      conversions: rawMetrics.conversions ?? undefined,
      spendETB:    rawMetrics.spendETB    ?? undefined,
    },
    create: {
      campaignId, date: today, source: "PROVIDER_API",
      impressions: rawMetrics.impressions ?? undefined,
      reach:       rawMetrics.reach       ?? undefined,
      clicks:      rawMetrics.clicks      ?? undefined,
      videoViews:  rawMetrics.videoViews  ?? undefined,
      likes:       rawMetrics.likes       ?? undefined,
      comments:    rawMetrics.comments    ?? undefined,
      shares:      rawMetrics.shares      ?? undefined,
      engagement:  rawMetrics.engagement  ?? undefined,
      conversions: rawMetrics.conversions ?? undefined,
      spendETB:    rawMetrics.spendETB    ?? undefined,
    },
  });

  await writeAuditLog({
    actorId:    adminId,
    actorType:  "ADMIN" as never,
    action:     "CAMPAIGN_METRICS_SYNCED",
    entityType: "Campaign",
    entityId:   campaignId,
    after:      { source: "PROVIDER_API", date: today.toISOString() },
    orderId:    campaign.order.id,
  });

  logger.info({ campaignId, provider: provider.name }, "Campaign metrics synced from provider");

  return {
    stored: true,
    metrics: {
      impressions: rawMetrics.impressions ?? null,
      reach:       rawMetrics.reach       ?? null,
      clicks:      rawMetrics.clicks      ?? null,
      videoViews:  rawMetrics.videoViews  ?? null,
      likes:       rawMetrics.likes       ?? null,
      comments:    rawMetrics.comments    ?? null,
      shares:      rawMetrics.shares      ?? null,
      engagement:  rawMetrics.engagement  ?? null,
      conversions: rawMetrics.conversions ?? null,
      spendETB:    rawMetrics.spendETB    ?? null,
    },
  };
}

// ─── Generate report ──────────────────────────────────────────────────────────

/**
 * Auto-generate a draft report for a campaign, pre-populated with
 * the latest available metrics. Admin reviews and publishes separately.
 * Idempotent: returns existing DRAFT report if one already exists.
 */
export async function generateCampaignReport(
  campaignId: string,
  { adminId, title }: GenerateReportOptions
): Promise<{ reportId: string; created: boolean }> {
  const campaign = await loadCampaignFull(campaignId);
  if (!campaign) throw new AppError(404, "NOT_FOUND", "Campaign not found");

  // Idempotent: return existing draft
  const existing = await prisma.report.findFirst({
    where: { campaignId, status: "DRAFT" },
    select: { id: true },
  });
  if (existing) return { reportId: existing.id, created: false };

  // Aggregate all metrics for summary
  const allMetrics = await prisma.campaignMetric.findMany({
    where: { campaignId },
    orderBy: { date: "desc" },
    select: {
      date: true, source: true,
      impressions: true, reach: true, clicks: true, videoViews: true,
      likes: true, comments: true, shares: true, engagement: true,
      conversions: true, spendETB: true,
    },
  });

  // Sum totals across all snapshots
  const totals = allMetrics.reduce((acc, m) => ({
    impressions: (acc.impressions ?? 0) + (m.impressions ?? 0),
    reach:       (acc.reach       ?? 0) + (m.reach       ?? 0),
    clicks:      (acc.clicks      ?? 0) + (m.clicks      ?? 0),
    videoViews:  (acc.videoViews  ?? 0) + (m.videoViews  ?? 0),
    likes:       (acc.likes       ?? 0) + (m.likes       ?? 0),
    comments:    (acc.comments    ?? 0) + (m.comments    ?? 0),
    shares:      (acc.shares      ?? 0) + (m.shares      ?? 0),
    engagement:  (acc.engagement  ?? 0) + (m.engagement  ?? 0),
    conversions: (acc.conversions ?? 0) + (m.conversions ?? 0),
    spendETB:    (acc.spendETB    ?? 0) + (m.spendETB    ?? 0),
  }), {} as Record<string, number>);

  const reportTitle = title ?? `${campaign.order.service.name} — Campaign Report`;

  const report = await prisma.report.create({
    data: {
      orderId:     campaign.order.id,
      campaignId,
      title:       reportTitle,
      periodStart: campaign.startDate ?? undefined,
      periodEnd:   campaign.endDate   ?? undefined,
      summary:     {
        generatedAt: new Date().toISOString(),
        totalMetrics: totals,
        snapshotCount: allMetrics.length,
        sources: [...new Set(allMetrics.map(m => m.source))],
        providerCampaignId: campaign.providerCampaignId,
      } as never,
      status:      "DRAFT",
      generatedAt: new Date(),
    },
  });

  await writeAuditLog({
    actorId:    adminId,
    actorType:  "ADMIN" as never,
    action:     "REPORT_GENERATED",
    entityType: "Report",
    entityId:   report.id,
    after:      { campaignId, snapshotCount: allMetrics.length },
    orderId:    campaign.order.id,
  });

  logger.info({ reportId: report.id, campaignId, snapshotCount: allMetrics.length }, "Campaign report generated");

  return { reportId: report.id, created: true };
}
