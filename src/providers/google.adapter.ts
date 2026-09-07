/**
 * Google Ads provider adapter — Phase 6
 *
 * Implements IAdProvider for Google Ads.
 *
 * CURRENT STATE: Sandbox/stub implementation.
 * Credentials required: GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_CUSTOMER_ID
 * + GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN
 *
 * All operations honour dryRun mode and return simulated results.
 * Real Google Ads API calls require OAuth2 and are not implemented yet.
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

export class GoogleAdsAdapter implements IAdProvider {
  readonly name = "Google Ads";

  private get developerToken(): string | undefined {
    return process.env["GOOGLE_ADS_DEVELOPER_TOKEN"];
  }

  private get customerId(): string | undefined {
    return process.env["GOOGLE_ADS_CUSTOMER_ID"];
  }

  private get clientId(): string | undefined {
    return process.env["GOOGLE_ADS_CLIENT_ID"];
  }

  private get clientSecret(): string | undefined {
    return process.env["GOOGLE_ADS_CLIENT_SECRET"];
  }

  private get refreshToken(): string | undefined {
    return process.env["GOOGLE_ADS_REFRESH_TOKEN"];
  }

  private get isConfigured(): boolean {
    return !!(this.developerToken && this.customerId && this.clientId && this.clientSecret && this.refreshToken);
  }

  // ── Validate ──────────────────────────────────────────────────────────────

  async validateCampaign(config: CampaignConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.targetUrl) errors.push("targetUrl is required");
    if (!config.targetUrl?.startsWith("https://")) errors.push("targetUrl must use HTTPS");
    if (!config.objective) errors.push("objective is required");
    if (!config.budgetETB || config.budgetETB <= 0) errors.push("budgetETB must be a positive integer");
    if (config.budgetETB && config.budgetETB < 1000_00) warnings.push("Google Ads recommends a minimum daily budget of 1000 ETB for effectiveness");
    if (!config.dailyBudgetETB && !config.budgetETB) errors.push("at least one of budgetETB or dailyBudgetETB is required");

    if (!this.isConfigured) {
      warnings.push("Google Ads credentials are not configured — real campaigns cannot be launched");
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
        providerCampaignId: `GOOGLE_DRYRUN_${config.idempotencyKey.slice(0, 12).toUpperCase()}`,
        dryRun: true,
        metadata: { simulated: true, objective: config.objective },
      };
    }

    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);

    // Real Google Ads API implementation placeholder:
    // Uses google-ads-api SDK or REST API v16+
    // Campaign must start as PAUSED — admin activates it after review.
    //
    // const client = new GoogleAdsApi({ developer_token: this.developerToken });
    // const customer = client.Customer({ customer_id: this.customerId, ... });
    // const [campaign] = await customer.campaigns.create([{ name, status: "PAUSED", ... }]);
    // return { providerCampaignId: campaign.resource_name, dryRun: false };

    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Google Ads API integration is not yet implemented — use dryRun=true", false);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign update simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required for update", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Google Ads API integration is not yet implemented", false);
  }

  // ── Pause ─────────────────────────────────────────────────────────────────

  async pauseCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign pause simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to pause", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Google Ads API integration is not yet implemented", false);
  }

  // ── Resume ────────────────────────────────────────────────────────────────

  async resumeCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign resume simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to resume", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Google Ads API integration is not yet implemented", false);
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  async cancelCampaign(config: CampaignConfig): Promise<void> {
    if (config.dryRun) {
      logger.info({ campaignId: config.campaignId, provider: this.name }, "DRY RUN — campaign cancel simulated");
      return;
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to cancel", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Google Ads API integration is not yet implemented", false);
  }

  // ── Status ────────────────────────────────────────────────────────────────

  async getCampaignStatus(config: CampaignConfig): Promise<StatusResult> {
    if (config.dryRun) {
      return { providerStatus: "PAUSED", internalStatus: "PAUSED", metadata: { simulated: true } };
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to get status", false);
    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Google Ads API integration is not yet implemented", false);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  async getCampaignMetrics(config: CampaignConfig): Promise<MetricsResult> {
    if (config.dryRun) {
      return {
        impressions: 0, reach: 0, clicks: 0,
        videoViews: 0, engagement: 0, conversions: 0,
        spendETB: 0, metadata: { simulated: true },
      };
    }
    if (!this.isConfigured) throw new ProviderNotConfiguredError(this.name);
    if (!config.providerCampaignId) throw new ProviderError(this.name, "MISSING_PROVIDER_ID", "providerCampaignId is required to get metrics", false);

    // Auth check stub
    if (this.refreshToken === "invalid") throw new ProviderAuthError(this.name, "OAuth2 refresh token is invalid");

    throw new ProviderError(this.name, "NOT_IMPLEMENTED", "Real Google Ads API integration is not yet implemented", false);
  }
}
