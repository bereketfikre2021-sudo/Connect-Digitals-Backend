/**
 * Integration tests — CampaignService (Phase 7)
 *
 * Tests the campaign service layer in isolation by:
 * - Mocking prisma with vi.mock so no real DB is needed
 * - Mocking the provider registry to inject controllable adapters
 * - Verifying budget enforcement, duplicate prevention, failure handling,
 *   admin overrides, metrics sync, report generation, and audit logging
 *
 * No real advertising spend occurs. No real DB access.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ─── Mock env (prevents DATABASE_URL required() check at module load) ────────
vi.mock("../../src/lib/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 3000,
    DATABASE_URL: "postgresql://test",
    TELEGRAM_BOT_TOKEN: "test_token",
    TELEGRAM_BOT_USERNAME: "",
    MINI_APP_URL: "",
    ADMIN_URL: "",
    CORS_ALLOWED_ORIGINS: "*",
    LOG_LEVEL: "silent",
    SUPABASE_URL: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_ANON_KEY: "",
    META_ADS_ACCESS_TOKEN: "",
    META_ADS_AD_ACCOUNT_ID: "",
    GOOGLE_ADS_DEVELOPER_TOKEN: "",
    GOOGLE_ADS_CUSTOMER_ID: "",
    GOOGLE_ADS_CLIENT_ID: "",
    GOOGLE_ADS_CLIENT_SECRET: "",
    GOOGLE_ADS_REFRESH_TOKEN: "",
    TIKTOK_ADS_ACCESS_TOKEN: "",
    TIKTOK_ADS_ADVERTISER_ID: "",
    isDev: () => false,
    isProd: () => false,
  },
}));

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Mock prisma ──────────────────────────────────────────────────────────────
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    campaign: {
      findUnique: vi.fn(),
      update:     vi.fn(),
      findFirst:  vi.fn(),
    },
    campaignMetric: {
      upsert:    vi.fn(),
      findMany:  vi.fn(),
    },
    report: {
      findFirst: vi.fn(),
      create:    vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

// ─── Mock provider registry ───────────────────────────────────────────────────
vi.mock("../../src/providers/index.js", () => ({
  getProvider:      vi.fn(),
  requiresProvider: vi.fn(),
}));

// ─── Mock audit service ───────────────────────────────────────────────────────
vi.mock("../../src/services/audit.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock notification service ────────────────────────────────────────────────
vi.mock("../../src/services/notification.service.js", () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "../../src/lib/prisma.js";
import { getProvider, requiresProvider } from "../../src/providers/index.js";
import { writeAuditLog } from "../../src/services/audit.service.js";
import {
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaignViaProvider,
  retryCampaign,
  syncCampaignMetrics,
  generateCampaignReport,
} from "../../src/services/campaign.service.js";
import {
  ProviderError,
  ProviderNotConfiguredError,
} from "../../src/providers/types.js";
import type { IAdProvider } from "../../src/providers/types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN_ID = "admin_001";
const CAMPAIGN_ID = "cmp_001";
const ORDER_ID = "ord_001";
const TASK_ID = "task_001";

function mockCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    internalStatus: "DRAFT",
    provider: "META_ADS",
    providerCampaignId: null,
    targetUrl: "https://example.com/profile",
    objective: "TikTok Followers",
    budgetETB: 5000_00,
    dailyBudgetETB: null,
    durationDays: 7,
    startDate: null,
    endDate: null,
    fulfillmentTaskId: TASK_ID,
    order: {
      id: ORDER_ID,
      orderNumber: "CD10001",
      userId: "user_001",
      totalAmountETB: 10000_00,
      service: { name: "Meta Followers", fulfillmentType: "META_ADS" },
    },
    fulfillmentTask: { id: TASK_ID, fulfillmentType: "META_ADS" },
    metrics: [],
    ...overrides,
  };
}

function mockProvider(overrides: Partial<IAdProvider> = {}): IAdProvider {
  return {
    name: "Meta Ads",
    validateCampaign: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    createCampaign:   vi.fn().mockResolvedValue({ providerCampaignId: "META_REAL_123", dryRun: false }),
    updateCampaign:   vi.fn().mockResolvedValue(undefined),
    pauseCampaign:    vi.fn().mockResolvedValue(undefined),
    resumeCampaign:   vi.fn().mockResolvedValue(undefined),
    cancelCampaign:   vi.fn().mockResolvedValue(undefined),
    getCampaignStatus: vi.fn().mockResolvedValue({ providerStatus: "ACTIVE", internalStatus: "ACTIVE" }),
    getCampaignMetrics: vi.fn().mockResolvedValue({
      impressions: 1000, reach: 800, clicks: 50, likes: 120,
      engagement: 200, spendETB: 500_00,
    }),
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (requiresProvider as Mock).mockReturnValue(true);
  (getProvider as Mock).mockReturnValue(mockProvider());
  (prisma.campaign.findUnique as Mock).mockResolvedValue(mockCampaign());
  (prisma.campaign.update as Mock).mockResolvedValue({});
  (prisma.campaignMetric.upsert as Mock).mockResolvedValue({});
  (prisma.campaignMetric.findMany as Mock).mockResolvedValue([]);
  (prisma.report.findFirst as Mock).mockResolvedValue(null);
  (prisma.report.create as Mock).mockResolvedValue({ id: "rep_001" });
});

// ─── launchCampaign ───────────────────────────────────────────────────────────

describe("launchCampaign", () => {
  it("calls provider.createCampaign and stores providerCampaignId", async () => {
    const result = await launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false });

    expect(result.providerCampaignId).toBe("META_REAL_123");
    expect(result.dryRun).toBe(false);
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CAMPAIGN_ID },
        data: expect.objectContaining({ providerCampaignId: "META_REAL_123" }),
      })
    );
  });

  it("writes an audit log on success", async () => {
    await launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CAMPAIGN_LAUNCHED", entityId: CAMPAIGN_ID })
    );
  });

  it("dry-run returns dryRun=true without real provider call", async () => {
    const provider = mockProvider({
      createCampaign: vi.fn().mockResolvedValue({ providerCampaignId: "META_DRYRUN_ABC", dryRun: true }),
    });
    (getProvider as Mock).mockReturnValue(provider);

    const result = await launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.providerCampaignId).toBe("META_DRYRUN_ABC");
  });

  it("blocks duplicate launch when providerCampaignId already set", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ providerCampaignId: "META_EXISTING_999" })
    );

    await expect(
      launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false })
    ).rejects.toThrow("already registered");
  });

  it("blocks launch when budget exceeds order total", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ budgetETB: 99999_00, order: { id: ORDER_ID, orderNumber: "CD10001", userId: "user_001", totalAmountETB: 5000_00, service: { name: "Meta Followers", fulfillmentType: "META_ADS" } } })
    );

    await expect(
      launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false })
    ).rejects.toThrow("exceeds order total");
  });

  it("blocks launch when budget is zero", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ budgetETB: 0 })
    );

    await expect(
      launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false })
    ).rejects.toThrow("budget must be set");
  });

  it("blocks launch for non-DRAFT/PENDING status", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE" })
    );

    await expect(
      launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false })
    ).rejects.toThrow("ACTIVE");
  });

  it("blocks launch for MANUAL fulfillment type", async () => {
    (requiresProvider as Mock).mockReturnValue(false);

    await expect(
      launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false })
    ).rejects.toThrow("manual fulfillment");
  });

  it("blocks launch when validation fails", async () => {
    const provider = mockProvider({
      validateCampaign: vi.fn().mockResolvedValue({
        valid: false,
        errors: ["targetUrl must use HTTPS"],
        warnings: [],
      }),
    });
    (getProvider as Mock).mockReturnValue(provider);

    await expect(
      launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false })
    ).rejects.toThrow("Campaign validation failed");
  });

  it("marks campaign FAILED and writes audit log on provider error", async () => {
    const provider = mockProvider({
      createCampaign: vi.fn().mockRejectedValue(new ProviderError("Meta Ads", "API_ERROR", "Internal server error")),
    });
    (getProvider as Mock).mockReturnValue(provider);

    await expect(
      launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false })
    ).rejects.toThrow("Campaign launch failed");

    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ internalStatus: "FAILED" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CAMPAIGN_LAUNCH_FAILED" })
    );
  });

  it("does not expose raw provider error details in thrown AppError", async () => {
    const provider = mockProvider({
      createCampaign: vi.fn().mockRejectedValue(
        new ProviderError("Meta Ads", "AUTH_ERROR", "access_token=EAABwzLixnjYBO_secret_1234567890abcdef")
      ),
    });
    (getProvider as Mock).mockReturnValue(provider);

    try {
      await launchCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID, dryRun: false });
    } catch (err: unknown) {
      const error = err as { message: string };
      // Raw token must not appear in the public error message
      expect(error.message).not.toContain("EAABwzLixnjYBO_secret_1234567890abcdef");
    }
  });
});

// ─── Admin overrides ──────────────────────────────────────────────────────────

describe("pauseCampaign", () => {
  it("calls provider.pauseCampaign and updates status to PAUSED", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE", providerCampaignId: "META_123" })
    );
    const provider = mockProvider();
    (getProvider as Mock).mockReturnValue(provider);

    await pauseCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID });

    expect(provider.pauseCampaign).toHaveBeenCalled();
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { internalStatus: "PAUSED" } })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CAMPAIGN_PAUSED" })
    );
  });

  it("throws when campaign is not ACTIVE", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "DRAFT", providerCampaignId: "META_123" })
    );

    await expect(pauseCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID })).rejects.toThrow("Cannot pause");
  });

  it("throws AppError with 502 statusCode if provider call fails", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE", providerCampaignId: "META_123" })
    );
    (getProvider as Mock).mockReturnValue(mockProvider({
      pauseCampaign: vi.fn().mockRejectedValue(new ProviderError("Meta Ads", "API_ERROR", "failed")),
    }));

    await expect(
      pauseCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID })
    ).rejects.toMatchObject({ statusCode: 502, code: "PROVIDER_ERROR" });
  });
});

describe("resumeCampaign", () => {
  it("calls provider.resumeCampaign and updates status to ACTIVE", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "PAUSED", providerCampaignId: "META_123" })
    );
    const provider = mockProvider();
    (getProvider as Mock).mockReturnValue(provider);

    await resumeCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID });

    expect(provider.resumeCampaign).toHaveBeenCalled();
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { internalStatus: "ACTIVE" } })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CAMPAIGN_RESUMED" })
    );
  });

  it("throws when campaign is not PAUSED", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE", providerCampaignId: "META_123" })
    );

    await expect(resumeCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID })).rejects.toThrow("Cannot resume");
  });
});

describe("cancelCampaignViaProvider", () => {
  it("calls provider.cancelCampaign and updates status to CANCELLED", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE", providerCampaignId: "META_123" })
    );
    const provider = mockProvider();
    (getProvider as Mock).mockReturnValue(provider);

    await cancelCampaignViaProvider(CAMPAIGN_ID, { adminId: ADMIN_ID });

    expect(provider.cancelCampaign).toHaveBeenCalled();
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ internalStatus: "CANCELLED" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CAMPAIGN_CANCELLED" })
    );
  });

  it("cancels locally even if no providerCampaignId yet (not launched)", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "PENDING", providerCampaignId: null })
    );
    const provider = mockProvider();
    (getProvider as Mock).mockReturnValue(provider);

    await cancelCampaignViaProvider(CAMPAIGN_ID, { adminId: ADMIN_ID });

    // Provider call skipped — no providerCampaignId
    expect(provider.cancelCampaign).not.toHaveBeenCalled();
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ internalStatus: "CANCELLED" }) })
    );
  });

  it("throws when already CANCELLED", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "CANCELLED", providerCampaignId: "META_123" })
    );

    await expect(
      cancelCampaignViaProvider(CAMPAIGN_ID, { adminId: ADMIN_ID })
    ).rejects.toThrow("CANCELLED");
  });
});

describe("retryCampaign", () => {
  it("resets FAILED campaign to DRAFT and re-launches", async () => {
    (prisma.campaign.findUnique as Mock)
      .mockResolvedValueOnce(mockCampaign({ internalStatus: "FAILED" }))   // first load for retry
      .mockResolvedValueOnce(mockCampaign({ internalStatus: "DRAFT" }));   // second load for launch

    const result = await retryCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID });

    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ internalStatus: "DRAFT", providerCampaignId: null }),
      })
    );
    expect(result.providerCampaignId).toBe("META_REAL_123");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CAMPAIGN_RETRY_INITIATED" })
    );
  });

  it("throws when campaign is not FAILED", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE" })
    );

    await expect(retryCampaign(CAMPAIGN_ID, { adminId: ADMIN_ID })).rejects.toThrow("retry only allowed from FAILED");
  });
});

// ─── syncCampaignMetrics ──────────────────────────────────────────────────────

describe("syncCampaignMetrics", () => {
  it("fetches metrics from provider and upserts PROVIDER_API snapshot", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE", providerCampaignId: "META_123" })
    );

    const result = await syncCampaignMetrics(CAMPAIGN_ID, { adminId: ADMIN_ID });

    expect(result.stored).toBe(true);
    expect(result.metrics.impressions).toBe(1000);
    expect(result.metrics.likes).toBe(120);
    expect(prisma.campaignMetric.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ source: "PROVIDER_API" }) })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CAMPAIGN_METRICS_SYNCED" })
    );
  });

  it("throws 503 when provider is not configured", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE", providerCampaignId: "META_123" })
    );
    (getProvider as Mock).mockReturnValue(mockProvider({
      getCampaignMetrics: vi.fn().mockRejectedValue(new ProviderNotConfiguredError("Meta Ads")),
    }));

    await expect(
      syncCampaignMetrics(CAMPAIGN_ID, { adminId: ADMIN_ID })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("throws 409 when campaign status does not support sync", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "DRAFT", providerCampaignId: "META_123" })
    );

    await expect(
      syncCampaignMetrics(CAMPAIGN_ID, { adminId: ADMIN_ID })
    ).rejects.toThrow("Cannot sync metrics");
  });

  it("throws 409 when no providerCampaignId", async () => {
    (prisma.campaign.findUnique as Mock).mockResolvedValue(
      mockCampaign({ internalStatus: "ACTIVE", providerCampaignId: null })
    );

    await expect(
      syncCampaignMetrics(CAMPAIGN_ID, { adminId: ADMIN_ID })
    ).rejects.toThrow("not been launched yet");
  });
});

// ─── generateCampaignReport ───────────────────────────────────────────────────

describe("generateCampaignReport", () => {
  it("creates a draft report with metrics summary", async () => {
    (prisma.campaignMetric.findMany as Mock).mockResolvedValue([
      { date: new Date(), source: "MANUAL", likes: 100, impressions: 500, reach: 400, clicks: 20, videoViews: 0, comments: 10, shares: 5, engagement: 135, conversions: 0, spendETB: 200_00 },
      { date: new Date(), source: "PROVIDER_API", likes: 80, impressions: 300, reach: 200, clicks: 10, videoViews: 50, comments: 8, shares: 3, engagement: 101, conversions: 2, spendETB: 150_00 },
    ]);

    const result = await generateCampaignReport(CAMPAIGN_ID, { adminId: ADMIN_ID });

    expect(result.created).toBe(true);
    expect(result.reportId).toBe("rep_001");
    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: CAMPAIGN_ID,
          status: "DRAFT",
          orderId: ORDER_ID,
        }),
      })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "REPORT_GENERATED" })
    );
  });

  it("uses custom title when provided", async () => {
    await generateCampaignReport(CAMPAIGN_ID, { adminId: ADMIN_ID, title: "My Custom Report" });

    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "My Custom Report" }),
      })
    );
  });

  it("is idempotent — returns existing draft without creating a duplicate", async () => {
    (prisma.report.findFirst as Mock).mockResolvedValue({ id: "rep_existing" });

    const result = await generateCampaignReport(CAMPAIGN_ID, { adminId: ADMIN_ID });

    expect(result.created).toBe(false);
    expect(result.reportId).toBe("rep_existing");
    expect(prisma.report.create).not.toHaveBeenCalled();
  });

  it("generates report even with zero metrics snapshots", async () => {
    (prisma.campaignMetric.findMany as Mock).mockResolvedValue([]);

    const result = await generateCampaignReport(CAMPAIGN_ID, { adminId: ADMIN_ID });
    expect(result.created).toBe(true);
  });
});
