/**
 * TikTok Ads provider adapter — Phase 6
 *
 * Implements IAdProvider for TikTok Ads Manager.
 *
 * CURRENT STATE: Sandbox/stub implementation.
 * Credentials required: TIKTOK_ADS_ACCESS_TOKEN + TIKTOK_ADS_ADVERTISER_ID
 *
 * All operations honour dryRun mode and return simulated results.
 * Real TikTok Ads API calls are not implemented yet.
 *
 * Credentials are read from env — never from request bodies or DB.
 * Credentials are never logged.
 */

import {
  IAdProvider,
  CampaignConfig,
  ValidationResult,
  CreateResult,
  StatusResult,
  MetricsResult,
  ProviderAuthError,
  ProviderNotConfiguredError,
  ProviderError,
} from "./types.js";
import { providerLogger as logger } from "./provider-logger.js";

export class TikTokAdsAdapter implements IAdProvider {
  readonly name = "TikTok Ads";

  private get accessToken(): string | undefined {
    return process.env["TIKTOK_ADS_ACCESS_TOKEN"];
  }

  private get advertiserId(): string | undefined {
    return process.env["TIKTOK_ADS_ADVERTISER_ID"];
  }

  private get isConfigured(): boolean {
    return !!this.accessToken && !!this.advertiserId;
  }

  // ── Validate ──────────────────────────────────────────────────────────────

  async validateCampaign(config: CampaignConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.targetUrl) errors.push("targetUrl is required");
    if (!config.targetUrl?.startsWith("https://")) errors.push("targetUrl must use HTTPS");
    if (!config.objective) errors.push("objective is required");
    if (!config.budgetETB || config.budgetETB <= 0) errors.push("budgetETB must be a positive integer");
    if (config.budgetETB && config.budgetETB < 2000_00) warnings.push("TikTok Ads recommends a minimum campaign budget of 2000 ETB");
    if (config.durationDays && config.durationDays < 1) errors.push("durationDays must be at least 1");

    if (!this.isConfigured) {
      warnings.push("TikTok Ads credentials are not configured — real campaigns cannot be launched");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createCampaign(config: CampaignConfig): Promise<CreateResult> {
    const validation = await this.validateCampaign(config);
    if (!validation.valid) {
      throw new ProviderError(this.name, "INVALID_CONFIG", `Validation failed: ${validation.errors.join(", ")}`, false);
    }

    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign creation simulated, no API call made");
      return {
        providerCampaignId: `TIKTOK_DRYRUN_${config.idempotencyKey.slice(0, 12).toUpperCase()}`,
        dryRun: true,
        metadata: { simulated: true, objective: config.objective },
      };
    }

    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);

    // Real TikTok Ads API implementation placeholder (v1.3):
    // Campaign must start in CAMPAIGN_STATUS_DISABLE — admin enables it.
    //
    // const response = await fetch(
    //   "https://business-api.tiktok.com/open_api/v1.3/campaign/create/",
    //   {
    //     method: "POST",
    //     headers: {
    //       "Content-Type": "application/json",
    //       "Access-Token": this.accessToken,   // Never log this
    //     },
    //     body: JSON.stringify({
    //       advertiser_id: this.advertiserId,
    //       campaign_name: config.objective,
    //       objective_type: "VIDEO_VIEWS",
    //       budget_mode: "BUDGET_MODE_TOTAL",
    //       budget: config.budgetETB / 100,     // Convert cents to ETB
    //       campaign_status: "CAMPAIGN_STATUS_DISABLE",
    //     }),
    //   }
    // );
    // const data = await response.json();
    // if (data.code !== 0) throw new ProviderError(this.name, String(data.code), data.message, false);
    // return { providerCampaignId: data.data.campaign_id, dryRun: false };

    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real TikTok Ads API integration is not yet implemented — use dryRun=true", false);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign update simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required for update", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real TikTok Ads API integration is not yet implemented", false);
  }

  // ── Pause ─────────────────────────────────────────────────────────────────

  async pauseCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign pause simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to pause", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real TikTok Ads API integration is not yet implemented", false);
  }

  // ── Resume ────────────────────────────────────────────────────────────────

  async resumeCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign resume simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to resume", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real TikTok Ads API integration is not yet implemented", false);
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancelCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign cancel simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to cancel", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real TikTok Ads API integration is not yet implemented", false);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async getCampaignStatus(config: CampaignConfig): Promise<StatusResult> {
    if (config.dryRun) {
      return { providerStatus: "CAMPAIGN_STATUS_DISABLE", internalStatus: "PAUSED", metadata: { simulated: true } };
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to get status", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real TikTok Ads API integration is not yet implemented", false);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  async getCampaignMetrics(config: CampaignConfig): Promise<MetricsResult> {
    if (config.dryRun) {
      return {
        impressions: 0, videoViews: 0, likes: 0,
        comments: 0, shares: 0, engagement: 0,
        spendETB: 0, metadata: { simulated: true },
      };
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to get metrics", false);

    // Auth check stub
    if (this.accessToken === "invalid") throw new ProviderAuthError(this.name);

    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real TikTok Ads API integration is not yet implemented", false);
  }
}
