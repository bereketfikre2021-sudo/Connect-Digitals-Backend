/**
 * Meta Ads provider adapter — Phase 6
 *
 * Implements IAdProvider for Meta Ads (Facebook/Instagram).
 *
 * CURRENT STATE: Sandbox/stub implementation.
 * All operations validate inputs and return realistic simulated responses.
 * Real Meta Marketing API calls are NOT made until credentials are
 * configured AND dryRun is explicitly set to false by an authorized admin.
 *
 * When META_ADS_ACCESS_TOKEN and META_ADS_AD_ACCOUNT_ID are present in the
 * environment, the adapter is "configured" but still honours dryRun mode.
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

export class MetaAdsAdapter implements IAdProvider {
  readonly name = "Meta Ads";

  private get accessToken(): string | undefined {
    return process.env["META_ADS_ACCESS_TOKEN"];
  }

  private get adAccountId(): string | undefined {
    return process.env["META_ADS_AD_ACCOUNT_ID"];
  }

  private get isConfigured(): boolean {
    return !!this.accessToken && !!this.adAccountId;
  }

  // ── Validate ──────────────────────────────────────────────────────────────

  async validateCampaign(config: CampaignConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.targetUrl) errors.push("targetUrl is required");
    if (!config.targetUrl?.startsWith("https://")) errors.push("targetUrl must use HTTPS");
    if (!config.objective) errors.push("objective is required");
    if (!config.budgetETB || config.budgetETB <= 0) errors.push("budgetETB must be a positive integer");
    if (config.budgetETB && config.budgetETB < 500_00) warnings.push("Meta Ads recommends a minimum daily budget of 500 ETB");
    if (config.durationDays && config.durationDays < 1) errors.push("durationDays must be at least 1");

    if (!this.isConfigured) {
      warnings.push("Meta Ads credentials are not configured — real campaigns cannot be launched");
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
        providerCampaignId: `META_DRYRUN_${config.idempotencyKey.slice(0, 12).toUpperCase()}`,
        dryRun: true,
        metadata: { simulated: true, objective: config.objective },
      };
    }

    if (!this.isConfigured) {
      throw new ProviderNotConfiguredError(this.name);
    }

    // Real Meta Marketing API call goes here when credentials are present.
    // Implementation placeholder — replace with actual SDK call:
    //
    //   const response = await fetch(
    //     `https://graph.facebook.com/v19.0/act_${this.adAccountId}/campaigns`,
    //     {
    //       method: "POST",
    //       headers: { "Content-Type": "application/json" },
    //       body: JSON.stringify({
    //         name: config.objective,
    //         objective: "OUTCOME_ENGAGEMENT",
    //         status: "PAUSED",            // Always start paused — admin activates
    //         special_ad_categories: [],
    //         access_token: this.accessToken, // Never log this
    //       }),
    //     }
    //   );
    //   const data = await response.json();
    //   if (data.error) throw new ProviderError(this.name, data.error.code, data.error.message, data.error.is_transient);
    //   return { providerCampaignId: data.id, dryRun: false };

    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Meta Ads API integration is not yet implemented — use dryRun=true", false);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign update simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required for update", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Meta Ads API integration is not yet implemented", false);
  }

  // ── Pause ─────────────────────────────────────────────────────────────────

  async pauseCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign pause simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to pause", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Meta Ads API integration is not yet implemented", false);
  }

  // ── Resume ────────────────────────────────────────────────────────────────

  async resumeCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign resume simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to resume", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Meta Ads API integration is not yet implemented", false);
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancelCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign cancel simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to cancel", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Meta Ads API integration is not yet implemented", false);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async getCampaignStatus(config: CampaignConfig): Promise<StatusResult> {
    if (config.dryRun) {
      return { providerStatus: "PAUSED", internalStatus: "PAUSED", metadata: { simulated: true } };
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to get status", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Meta Ads API integration is not yet implemented", false);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  async getCampaignMetrics(config: CampaignConfig): Promise<MetricsResult> {
    if (config.dryRun) {
      return {
        impressions: 0, reach: 0, clicks: 0,
        likes: 0, comments: 0, shares: 0,
        engagement: 0, spendETB: 0,
        metadata: { simulated: true },
      };
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to get metrics", false);

    // Auth check stub — real implementation would verify token
    if (this.accessToken === "invalid") throw new ProviderAuthError(this.name);

    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Meta Ads API integration is not yet implemented", false);
  }
}
