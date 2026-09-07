/**
 * Provider adapter interface — Phase 6
 *
 * All advertising provider adapters implement IAdProvider.
 * The fulfillment engine calls this interface; it never imports
 * provider-specific modules directly.
 *
 * DRY-RUN RULE: When dryRun=true on CampaignConfig, adapters MUST
 * validate inputs and return a simulated response WITHOUT making any
 * real API call and WITHOUT spending real money.
 *
 * APPROVAL RULE: The fulfillment engine will only call createCampaign()
 * after admin approval has been recorded. Adapters must not enforce this
 * themselves — it is enforced at the service layer.
 */

// ─── Config passed from the fulfillment engine to every adapter operation ────

export interface CampaignConfig {
  /** Internal campaign ID (our DB) */
  campaignId: string;
  /** Provider-assigned campaign ID — present after createCampaign() */
  providerCampaignId?: string;
  /** The URL being promoted */
  targetUrl: string;
  /** Human-readable campaign objective, e.g. "TikTok Followers" */
  objective: string;
  /** Total budget in ETB cents */
  budgetETB: number;
  /** Daily budget in ETB cents (optional) */
  dailyBudgetETB?: number;
  /** Campaign duration in days */
  durationDays?: number;
  /** ISO datetime string */
  startDate?: string;
  /** ISO datetime string */
  endDate?: string;
  /**
   * When true: validate inputs and return a simulated result.
   * NO real API call must be made. NO money must be spent.
   */
  dryRun: boolean;
  /** Idempotency key — re-sending the same key must not create a duplicate */
  idempotencyKey: string;
  /** Provider-specific extra config (geo, audience, etc.) */
  extra?: Record<string, unknown>;
}

// ─── Results returned by adapter operations ───────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CreateResult {
  /** Provider-assigned campaign ID */
  providerCampaignId: string;
  /** Whether this was a dry-run simulation */
  dryRun: boolean;
  /** Provider-specific raw response data (never logged at info level) */
  metadata?: Record<string, unknown>;
}

export interface StatusResult {
  /** Provider's own status string */
  providerStatus: string;
  /** Normalised internal status */
  internalStatus: "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED" | "UNKNOWN";
  metadata?: Record<string, unknown>;
}

export interface MetricsResult {
  impressions?:  number;
  reach?:        number;
  clicks?:       number;
  videoViews?:   number;
  likes?:        number;
  comments?:     number;
  shares?:       number;
  engagement?:   number;
  conversions?:  number;
  /** Spend in ETB cents */
  spendETB?:     number;
  metadata?: Record<string, unknown>;
}

// ─── The adapter contract ─────────────────────────────────────────────────────

export interface IAdProvider {
  /** Provider name — for logging and audit records */
  readonly name: string;

  /**
   * Validate campaign configuration before any creation attempt.
   * Must never make a real API call.
   * Returns { valid: true } or a list of validation errors.
   */
  validateCampaign(config: CampaignConfig): Promise<ValidationResult>;

  /**
   * Create a campaign on the provider platform.
   * If config.dryRun=true, simulate the creation and return a fake ID.
   * Idempotent: same idempotencyKey → same result, no duplicate created.
   */
  createCampaign(config: CampaignConfig): Promise<CreateResult>;

  /**
   * Update an existing campaign's config (budget, schedule, etc.).
   * If config.dryRun=true, simulate and return without calling the API.
   */
  updateCampaign(config: CampaignConfig): Promise<void>;

  /**
   * Pause a running campaign.
   * Idempotent: pausing an already-paused campaign is not an error.
   */
  pauseCampaign(config: CampaignConfig): Promise<void>;

  /**
   * Resume a paused campaign.
   * Idempotent: resuming an active campaign is not an error.
   */
  resumeCampaign(config: CampaignConfig): Promise<void>;

  /**
   * Cancel and stop a campaign permanently.
   * Idempotent: cancelling an already-cancelled campaign is not an error.
   */
  cancelCampaign(config: CampaignConfig): Promise<void>;

  /**
   * Fetch the current status of a campaign from the provider.
   */
  getCampaignStatus(config: CampaignConfig): Promise<StatusResult>;

  /**
   * Fetch the latest performance metrics for a campaign.
   * Returns partial metrics — not all providers report all fields.
   */
  getCampaignMetrics(config: CampaignConfig): Promise<MetricsResult>;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(`[${provider}] ${code}: ${message}`);
    this.name = "ProviderError";
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(provider: string, message = "Authentication failed") {
    super(provider, "AUTH_ERROR", message, false);
    this.name = "ProviderAuthError";
  }
}

export class ProviderValidationError extends ProviderError {
  constructor(provider: string, message: string, public readonly fields?: string[]) {
    super(provider, "VALIDATION_ERROR", message, false);
    this.name = "ProviderValidationError";
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(provider: string, message = "Rate limit exceeded") {
    super(provider, "RATE_LIMIT", message, true);
    this.name = "ProviderRateLimitError";
  }
}

export class ProviderNotConfiguredError extends ProviderError {
  constructor(provider: string) {
    super(provider, "NOT_CONFIGURED", `${provider} credentials are not configured`, false);
    this.name = "ProviderNotConfiguredError";
  }
}
