/**
 * Unit tests — Ad provider adapters (Phase 6)
 *
 * Tests cover:
 * - validateCampaign: valid and invalid configs
 * - createCampaign: dry-run mode, not-configured error, validation failure
 * - pause/resume/cancel: dry-run pass-through
 * - getCampaignStatus: dry-run simulated response
 * - getCampaignMetrics: dry-run simulated metrics, auth error stub
 * - idempotency: same idempotencyKey in dry-run returns stable prefix
 * - ProviderError hierarchy
 * - getProvider registry: correct adapter returned per type
 * - requiresProvider: MANUAL and CUSTOM are excluded
 *
 * No real API calls are made — adapters are tested in isolation.
 * No DB access required.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MetaAdsAdapter }   from "../../src/providers/meta.adapter.js";
import { GoogleAdsAdapter } from "../../src/providers/google.adapter.js";
import { TikTokAdsAdapter } from "../../src/providers/tiktok.adapter.js";
import { getProvider, requiresProvider } from "../../src/providers/index.js";
import {
  ProviderError,
  ProviderAuthError,
  ProviderNotConfiguredError,
  type CampaignConfig,
} from "../../src/providers/types.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function validConfig(overrides: Partial<CampaignConfig> = {}): CampaignConfig {
  return {
    campaignId:     "cmp_test_001",
    targetUrl:      "https://example.com/profile",
    objective:      "TikTok Followers",
    budgetETB:      5000_00, // 5000 ETB in cents
    durationDays:   7,
    dryRun:         true,
    idempotencyKey: "idem-abc-123-xyz-456",
    ...overrides,
  };
}

// ─── Helper: clear env vars ───────────────────────────────────────────────────

function clearProviderEnv() {
  delete process.env["META_ADS_ACCESS_TOKEN"];
  delete process.env["META_ADS_AD_ACCOUNT_ID"];
  delete process.env["GOOGLE_ADS_DEVELOPER_TOKEN"];
  delete process.env["GOOGLE_ADS_CUSTOMER_ID"];
  delete process.env["GOOGLE_ADS_CLIENT_ID"];
  delete process.env["GOOGLE_ADS_CLIENT_SECRET"];
  delete process.env["GOOGLE_ADS_REFRESH_TOKEN"];
  delete process.env["TIKTOK_ADS_ACCESS_TOKEN"];
  delete process.env["TIKTOK_ADS_ADVERTISER_ID"];
}

function setMetaEnv(token = "test_meta_token", accountId = "act_123456") {
  process.env["META_ADS_ACCESS_TOKEN"]  = token;
  process.env["META_ADS_AD_ACCOUNT_ID"] = accountId;
}

function setGoogleEnv() {
  process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] = "test_dev_token";
  process.env["GOOGLE_ADS_CUSTOMER_ID"]     = "123456789";
  process.env["GOOGLE_ADS_CLIENT_ID"]       = "test_client_id";
  process.env["GOOGLE_ADS_CLIENT_SECRET"]   = "test_client_secret";
  process.env["GOOGLE_ADS_REFRESH_TOKEN"]   = "test_refresh_token";
}

function setTikTokEnv(token = "test_tiktok_token", advertiserId = "adv_789") {
  process.env["TIKTOK_ADS_ACCESS_TOKEN"] = token;
  process.env["TIKTOK_ADS_ADVERTISER_ID"] = advertiserId;
}

// ─── Meta Ads ─────────────────────────────────────────────────────────────────

describe("MetaAdsAdapter", () => {
  let adapter: MetaAdsAdapter;

  beforeEach(() => { adapter = new MetaAdsAdapter(); clearProviderEnv(); });
  afterEach(() => clearProviderEnv());

  describe("validateCampaign", () => {
    it("returns valid for a well-formed config", async () => {
      const result = await adapter.validateCampaign(validConfig());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns error when targetUrl is missing", async () => {
      const result = await adapter.validateCampaign(validConfig({ targetUrl: "" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("targetUrl is required");
    });

    it("returns error when targetUrl does not use HTTPS", async () => {
      const result = await adapter.validateCampaign(validConfig({ targetUrl: "http://example.com" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("targetUrl must use HTTPS");
    });

    it("returns error when objective is missing", async () => {
      const result = await adapter.validateCampaign(validConfig({ objective: "" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("objective is required");
    });

    it("returns error when budgetETB is zero", async () => {
      const result = await adapter.validateCampaign(validConfig({ budgetETB: 0 }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("budgetETB must be a positive integer");
    });

    it("includes a warning when credentials are not configured", async () => {
      const result = await adapter.validateCampaign(validConfig());
      expect(result.warnings.some(w => w.includes("credentials are not configured"))).toBe(true);
    });

    it("no credentials warning when env is set", async () => {
      setMetaEnv();
      const result = await adapter.validateCampaign(validConfig());
      expect(result.warnings.some(w => w.includes("credentials are not configured"))).toBe(false);
    });
  });

  describe("createCampaign — dry-run", () => {
    it("returns a dryRun=true result with a simulated provider ID", async () => {
      const result = await adapter.createCampaign(validConfig({ dryRun: true }));
      expect(result.dryRun).toBe(true);
      expect(result.providerCampaignId).toMatch(/^META_DRYRUN_/);
    });

    it("dry-run ID includes a prefix from the idempotencyKey", async () => {
      const config = validConfig({ dryRun: true, idempotencyKey: "idem-abc-123-xyz-456" });
      const result = await adapter.createCampaign(config);
      expect(result.providerCampaignId).toBe("META_DRYRUN_IDEM-ABC-123");
    });

    it("idempotency: same idempotencyKey produces the same dry-run ID", async () => {
      const config = validConfig({ dryRun: true });
      const r1 = await adapter.createCampaign(config);
      const r2 = await adapter.createCampaign(config);
      expect(r1.providerCampaignId).toBe(r2.providerCampaignId);
    });

    it("dry-run works without provider credentials", async () => {
      // No env set — should still succeed in dry-run
      await expect(adapter.createCampaign(validConfig({ dryRun: true }))).resolves.toBeDefined();
    });
  });

  describe("createCampaign — real mode (not configured)", () => {
    it("throws ProviderNotConfiguredError when credentials are absent", async () => {
      await expect(
        adapter.createCampaign(validConfig({ dryRun: false }))
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    });

    it("throws ProviderError when validation fails", async () => {
      setMetaEnv();
      await expect(
        adapter.createCampaign(validConfig({ dryRun: false, targetUrl: "" }))
      ).rejects.toBeInstanceOf(ProviderError);
    });

    it("throws NOT_IMPLEMENTED even when credentials are present (stub)", async () => {
      setMetaEnv();
      const err = await adapter.createCampaign(validConfig({ dryRun: false })).catch(e => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).code).toBe("NOT_IMPLEMENTED");
    });
  });

  describe("pause / resume / cancel — dry-run", () => {
    it("pauseCampaign resolves in dry-run", async () => {
      await expect(adapter.pauseCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined();
    });

    it("resumeCampaign resolves in dry-run", async () => {
      await expect(adapter.resumeCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined();
    });

    it("cancelCampaign resolves in dry-run", async () => {
      await expect(adapter.cancelCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined();
    });

    it("updateCampaign resolves in dry-run", async () => {
      await expect(adapter.updateCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined();
    });
  });

  describe("getCampaignStatus", () => {
    it("returns PAUSED internalStatus in dry-run", async () => {
      const result = await adapter.getCampaignStatus(validConfig({ dryRun: true }));
      expect(result.internalStatus).toBe("PAUSED");
      expect(result.metadata?.["simulated"]).toBe(true);
    });

    it("throws ProviderNotConfiguredError in real mode without credentials", async () => {
      await expect(
        adapter.getCampaignStatus(validConfig({ dryRun: false }))
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    });
  });

  describe("getCampaignMetrics", () => {
    it("returns zeroed metrics in dry-run", async () => {
      const result = await adapter.getCampaignMetrics(validConfig({ dryRun: true }));
      expect(result.impressions).toBe(0);
      expect(result.spendETB).toBe(0);
      expect(result.metadata?.["simulated"]).toBe(true);
    });

    it("throws ProviderAuthError when token is 'invalid'", async () => {
      setMetaEnv("invalid", "act_123");
      await expect(
        adapter.getCampaignMetrics(validConfig({ dryRun: false, providerCampaignId: "META_123" }))
      ).rejects.toBeInstanceOf(ProviderAuthError);
    });
  });
});

// ─── Google Ads ────────────────────────────────────────────────────────────────

describe("GoogleAdsAdapter", () => {
  let adapter: GoogleAdsAdapter;

  beforeEach(() => { adapter = new GoogleAdsAdapter(); clearProviderEnv(); });
  afterEach(() => clearProviderEnv());

  describe("validateCampaign", () => {
    it("returns valid for a well-formed config", async () => {
      const result = await adapter.validateCampaign(validConfig());
      expect(result.valid).toBe(true);
    });

    it("returns error when targetUrl is missing", async () => {
      const result = await adapter.validateCampaign(validConfig({ targetUrl: "" }));
      expect(result.valid).toBe(false);
    });

    it("includes credentials warning when not configured", async () => {
      const result = await adapter.validateCampaign(validConfig());
      expect(result.warnings.some(w => w.includes("credentials are not configured"))).toBe(true);
    });
  });

  describe("createCampaign — dry-run", () => {
    it("returns dryRun=true with GOOGLE_DRYRUN_ prefix", async () => {
      const result = await adapter.createCampaign(validConfig({ dryRun: true }));
      expect(result.dryRun).toBe(true);
      expect(result.providerCampaignId).toMatch(/^GOOGLE_DRYRUN_/);
    });

    it("idempotency: same key → same ID", async () => {
      const config = validConfig({ dryRun: true, idempotencyKey: "idem-same-key-0001" });
      const r1 = await adapter.createCampaign(config);
      const r2 = await adapter.createCampaign(config);
      expect(r1.providerCampaignId).toBe(r2.providerCampaignId);
    });
  });

  describe("createCampaign — real mode", () => {
    it("throws ProviderNotConfiguredError without credentials", async () => {
      await expect(
        adapter.createCampaign(validConfig({ dryRun: false }))
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    });

    it("throws NOT_IMPLEMENTED even with credentials (stub)", async () => {
      setGoogleEnv();
      const err = await adapter.createCampaign(validConfig({ dryRun: false })).catch(e => e);
      expect((err as ProviderError).code).toBe("NOT_IMPLEMENTED");
    });
  });

  describe("dry-run operations", () => {
    it("pause resolves", async () => { await expect(adapter.pauseCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined(); });
    it("resume resolves", async () => { await expect(adapter.resumeCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined(); });
    it("cancel resolves", async () => { await expect(adapter.cancelCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined(); });
    it("status returns PAUSED", async () => {
      const result = await adapter.getCampaignStatus(validConfig({ dryRun: true }));
      expect(result.internalStatus).toBe("PAUSED");
    });
    it("metrics return zeros", async () => {
      const result = await adapter.getCampaignMetrics(validConfig({ dryRun: true }));
      expect(result.impressions).toBe(0);
    });
  });

  describe("getCampaignMetrics — auth error", () => {
    it("throws ProviderAuthError when refreshToken is 'invalid'", async () => {
      setGoogleEnv();
      process.env["GOOGLE_ADS_REFRESH_TOKEN"] = "invalid";
      await expect(
        adapter.getCampaignMetrics(validConfig({ dryRun: false, providerCampaignId: "GOOGLE_123" }))
      ).rejects.toBeInstanceOf(ProviderAuthError);
    });
  });
});

// ─── TikTok Ads ───────────────────────────────────────────────────────────────

describe("TikTokAdsAdapter", () => {
  let adapter: TikTokAdsAdapter;

  beforeEach(() => { adapter = new TikTokAdsAdapter(); clearProviderEnv(); });
  afterEach(() => clearProviderEnv());

  describe("validateCampaign", () => {
    it("returns valid for a well-formed config", async () => {
      const result = await adapter.validateCampaign(validConfig());
      expect(result.valid).toBe(true);
    });

    it("returns error when targetUrl is not HTTPS", async () => {
      const result = await adapter.validateCampaign(validConfig({ targetUrl: "http://example.com" }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("targetUrl must use HTTPS");
    });

    it("returns error when budget is missing", async () => {
      const result = await adapter.validateCampaign(validConfig({ budgetETB: 0 }));
      expect(result.valid).toBe(false);
    });

    it("includes credentials warning when not configured", async () => {
      const result = await adapter.validateCampaign(validConfig());
      expect(result.warnings.some(w => w.includes("credentials are not configured"))).toBe(true);
    });
  });

  describe("createCampaign — dry-run", () => {
    it("returns dryRun=true with TIKTOK_DRYRUN_ prefix", async () => {
      const result = await adapter.createCampaign(validConfig({ dryRun: true }));
      expect(result.dryRun).toBe(true);
      expect(result.providerCampaignId).toMatch(/^TIKTOK_DRYRUN_/);
    });

    it("idempotency: same key → same ID", async () => {
      const config = validConfig({ dryRun: true, idempotencyKey: "idem-tiktok-idem-001" });
      const r1 = await adapter.createCampaign(config);
      const r2 = await adapter.createCampaign(config);
      expect(r1.providerCampaignId).toBe(r2.providerCampaignId);
    });

    it("dry-run does not require credentials", async () => {
      await expect(adapter.createCampaign(validConfig({ dryRun: true }))).resolves.toBeDefined();
    });
  });

  describe("createCampaign — real mode", () => {
    it("throws ProviderNotConfiguredError without credentials", async () => {
      await expect(
        adapter.createCampaign(validConfig({ dryRun: false }))
      ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
    });

    it("throws NOT_IMPLEMENTED even with credentials (stub)", async () => {
      setTikTokEnv();
      const err = await adapter.createCampaign(validConfig({ dryRun: false })).catch(e => e);
      expect((err as ProviderError).code).toBe("NOT_IMPLEMENTED");
    });
  });

  describe("dry-run operations", () => {
    it("pause resolves", async () => { await expect(adapter.pauseCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined(); });
    it("resume resolves", async () => { await expect(adapter.resumeCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined(); });
    it("cancel resolves", async () => { await expect(adapter.cancelCampaign(validConfig({ dryRun: true }))).resolves.toBeUndefined(); });
    it("status returns PAUSED internalStatus", async () => {
      const result = await adapter.getCampaignStatus(validConfig({ dryRun: true }));
      expect(result.internalStatus).toBe("PAUSED");
    });
    it("metrics return zeros", async () => {
      const result = await adapter.getCampaignMetrics(validConfig({ dryRun: true }));
      expect(result.videoViews).toBe(0);
      expect(result.spendETB).toBe(0);
    });
  });

  describe("getCampaignMetrics — auth error", () => {
    it("throws ProviderAuthError when token is 'invalid'", async () => {
      setTikTokEnv("invalid", "adv_789");
      await expect(
        adapter.getCampaignMetrics(validConfig({ dryRun: false, providerCampaignId: "TIKTOK_456" }))
      ).rejects.toBeInstanceOf(ProviderAuthError);
    });
  });
});

// ─── ProviderError hierarchy ──────────────────────────────────────────────────

describe("ProviderError hierarchy", () => {
  it("ProviderError is an instance of Error", () => {
    const err = new ProviderError("Test", "CODE", "message");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderError);
  });

  it("ProviderAuthError is retryable=false", () => {
    const err = new ProviderAuthError("Test");
    expect(err.retryable).toBe(false);
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.name).toBe("ProviderAuthError");
  });

  it("ProviderNotConfiguredError has correct code", () => {
    const err = new ProviderNotConfiguredError("Meta Ads");
    expect(err.code).toBe("NOT_CONFIGURED");
    expect(err.retryable).toBe(false);
  });

  it("retryable ProviderError sets retryable=true", () => {
    const err = new ProviderError("Meta Ads", "RATE_LIMIT", "too many requests", true);
    expect(err.retryable).toBe(true);
  });

  it("error message includes provider name and code", () => {
    const err = new ProviderError("Meta Ads", "AUTH_ERROR", "token expired");
    expect(err.message).toContain("Meta Ads");
    expect(err.message).toContain("AUTH_ERROR");
    expect(err.message).toContain("token expired");
  });
});

// ─── Provider registry ────────────────────────────────────────────────────────

describe("getProvider registry", () => {
  it("returns MetaAdsAdapter for META_ADS", () => {
    const p = getProvider("META_ADS");
    expect(p).not.toBeNull();
    expect(p?.name).toBe("Meta Ads");
  });

  it("returns GoogleAdsAdapter for GOOGLE_ADS", () => {
    const p = getProvider("GOOGLE_ADS");
    expect(p?.name).toBe("Google Ads");
  });

  it("returns TikTokAdsAdapter for TIKTOK_ADS", () => {
    const p = getProvider("TIKTOK_ADS");
    expect(p?.name).toBe("TikTok Ads");
  });

  it("returns null for MANUAL", () => {
    expect(getProvider("MANUAL")).toBeNull();
  });

  it("returns null for CUSTOM", () => {
    expect(getProvider("CUSTOM")).toBeNull();
  });

  it("returns undefined for unknown type", () => {
    expect(getProvider("UNKNOWN_PROVIDER")).toBeUndefined();
  });
});

// ─── requiresProvider ────────────────────────────────────────────────────────

describe("requiresProvider", () => {
  it("returns true for META_ADS", () => expect(requiresProvider("META_ADS")).toBe(true));
  it("returns true for GOOGLE_ADS", () => expect(requiresProvider("GOOGLE_ADS")).toBe(true));
  it("returns true for TIKTOK_ADS", () => expect(requiresProvider("TIKTOK_ADS")).toBe(true));
  it("returns false for MANUAL", () => expect(requiresProvider("MANUAL")).toBe(false));
  it("returns false for CUSTOM", () => expect(requiresProvider("CUSTOM")).toBe(false));
  it("returns false for unknown string", () => expect(requiresProvider("UNKNOWN")).toBe(false));
});

// ─── Admin approval gate (documented contract, not mocked) ────────────────────

describe("Admin approval gate", () => {
  it("dry-run always passes without credentials — approval gate is at the service layer", async () => {
    // This test documents the contract:
    // The provider adapter does NOT enforce admin approval — that is done in
    // fulfillment.service.ts before calling the adapter.
    // Adapters only enforce dryRun=true safety.
    clearProviderEnv();
    const meta = new MetaAdsAdapter();
    const result = await meta.createCampaign(validConfig({ dryRun: true }));
    expect(result.dryRun).toBe(true);
    // No error = adapter did not try to spend money
  });

  it("real-mode creation without credentials is blocked at adapter level", async () => {
    clearProviderEnv();
    const tiktok = new TikTokAdsAdapter();
    await expect(
      tiktok.createCampaign(validConfig({ dryRun: false }))
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });
});
