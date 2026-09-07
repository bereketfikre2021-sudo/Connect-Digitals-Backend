/**
 * Provider registry — Phase 6
 *
 * Maps FulfillmentType enum values to their adapter instances.
 * Adapters are singletons — created once and reused.
 * The fulfillment engine calls getProvider() to get the correct adapter.
 *
 * MANUAL fulfillment does not use a provider adapter — the registry
 * returns null for MANUAL so callers can skip provider logic entirely.
 */

import type { IAdProvider } from "./types.js";
import { MetaAdsAdapter }    from "./meta.adapter.js";
import { GoogleAdsAdapter }  from "./google.adapter.js";
import { TikTokAdsAdapter }  from "./tiktok.adapter.js";

// Singleton instances — one per provider type
const _meta   = new MetaAdsAdapter();
const _google = new GoogleAdsAdapter();
const _tiktok = new TikTokAdsAdapter();

const REGISTRY: Record<string, IAdProvider | null> = {
  MANUAL:      null,   // Manual fulfillment — no provider
  META_ADS:    _meta,
  GOOGLE_ADS:  _google,
  TIKTOK_ADS:  _tiktok,
  CUSTOM:      null,   // CUSTOM type handled outside this registry
};

/**
 * Returns the provider adapter for the given fulfillment type.
 * Returns null for MANUAL and CUSTOM — callers must handle these directly.
 * Returns undefined if the fulfillment type is unknown.
 */
export function getProvider(fulfillmentType: string): IAdProvider | null | undefined {
  if (fulfillmentType in REGISTRY) {
    return REGISTRY[fulfillmentType];
  }
  return undefined; // Unknown type — caller should treat as an error
}

/**
 * Returns true if this fulfillment type uses a provider adapter.
 */
export function requiresProvider(fulfillmentType: string): boolean {
  return fulfillmentType === "META_ADS" || fulfillmentType === "GOOGLE_ADS" || fulfillmentType === "TIKTOK_ADS";
}

// Re-export types for consumers
export type { IAdProvider, CampaignConfig, ValidationResult, CreateResult, StatusResult, MetricsResult } from "./types.js";
export { ProviderError, ProviderAuthError, ProviderValidationError, ProviderRateLimitError, ProviderNotConfiguredError } from "./types.js";
