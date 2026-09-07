/**
 * Shared enums — mirror the Prisma enums so non-DB packages can
 * import them without pulling in @prisma/client.
 *
 * These must stay in sync with prisma/schema.prisma.
 */

// ---------------------------------------------------------------------------
// Users & Auth
// ---------------------------------------------------------------------------

export enum AdminRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  ADMIN = "ADMIN",
  OPERATOR = "OPERATOR",
}

export enum UserStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  BANNED = "BANNED",
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export enum TargetType {
  PAGE = "PAGE",
  PROFILE = "PROFILE",
  POST = "POST",
  VIDEO = "VIDEO",
  CHANNEL = "CHANNEL",
  WEBSITE = "WEBSITE",
  CUSTOM = "CUSTOM",
}

export enum FulfillmentType {
  MANUAL = "MANUAL",
  META_ADS = "META_ADS",
  GOOGLE_ADS = "GOOGLE_ADS",
  TIKTOK_ADS = "TIKTOK_ADS",
  CUSTOM = "CUSTOM",
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export enum OrderStatus {
  PENDING_PAYMENT = "PENDING_PAYMENT",
  PAYMENT_SUBMITTED = "PAYMENT_SUBMITTED",
  PAYMENT_APPROVED = "PAYMENT_APPROVED",
  PAYMENT_REJECTED = "PAYMENT_REJECTED",
  PROCESSING = "PROCESSING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  UNDER_REVIEW = "UNDER_REVIEW",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  REFUNDED = "REFUNDED",
}

export enum FulfillmentStatus {
  PENDING = "PENDING",
  QUEUED = "QUEUED",
  AWAITING_APPROVAL = "AWAITING_APPROVAL",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export enum WalletTransactionType {
  DEPOSIT = "DEPOSIT",
  ORDER_PAYMENT = "ORDER_PAYMENT",
  REFUND = "REFUND",
  ADJUSTMENT = "ADJUSTMENT",
  REWARD = "REWARD",
}

// ---------------------------------------------------------------------------
// Campaigns & Metrics
// ---------------------------------------------------------------------------

export enum CampaignProvider {
  MANUAL = "MANUAL",
  META_ADS = "META_ADS",
  GOOGLE_ADS = "GOOGLE_ADS",
  TIKTOK_ADS = "TIKTOK_ADS",
}

export enum CampaignStatus {
  DRAFT = "DRAFT",
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  FAILED = "FAILED",
}

export enum MetricSource {
  MANUAL = "MANUAL",
  PROVIDER_API = "PROVIDER_API",
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export enum ReportStatus {
  DRAFT = "DRAFT",
  PUBLISHED = "PUBLISHED",
  ARCHIVED = "ARCHIVED",
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export enum NotificationChannel {
  TELEGRAM = "TELEGRAM",
}

export enum NotificationEvent {
  ORDER_CREATED = "ORDER_CREATED",
  PAYMENT_SUBMITTED = "PAYMENT_SUBMITTED",
  PAYMENT_APPROVED = "PAYMENT_APPROVED",
  PAYMENT_REJECTED = "PAYMENT_REJECTED",
  ORDER_PROCESSING = "ORDER_PROCESSING",
  FULFILLMENT_STARTED = "FULFILLMENT_STARTED",
  ORDER_COMPLETED = "ORDER_COMPLETED",
  ORDER_CANCELLED = "ORDER_CANCELLED",
  REFUND_ISSUED = "REFUND_ISSUED",
  REPORT_AVAILABLE = "REPORT_AVAILABLE",
  WALLET_CREDITED = "WALLET_CREDITED",
}

export enum AuditActorType {
  ADMIN = "ADMIN",
  CUSTOMER = "CUSTOMER",
  SYSTEM = "SYSTEM",
}

export enum AuditAction {
  // Payment
  PAYMENT_SUBMITTED = "PAYMENT_SUBMITTED",
  PAYMENT_APPROVED = "PAYMENT_APPROVED",
  PAYMENT_REJECTED = "PAYMENT_REJECTED",
  PAYMENT_REFUNDED = "PAYMENT_REFUNDED",
  // Wallet
  WALLET_CREDITED = "WALLET_CREDITED",
  WALLET_DEBITED = "WALLET_DEBITED",
  WALLET_ADJUSTED = "WALLET_ADJUSTED",
  // Orders
  ORDER_CREATED = "ORDER_CREATED",
  ORDER_STATUS_CHANGED = "ORDER_STATUS_CHANGED",
  ORDER_CANCELLED = "ORDER_CANCELLED",
  // Fulfillment
  FULFILLMENT_STATUS_CHANGED = "FULFILLMENT_STATUS_CHANGED",
  FULFILLMENT_ASSIGNED = "FULFILLMENT_ASSIGNED",
  // Campaigns
  CAMPAIGN_CREATED = "CAMPAIGN_CREATED",
  CAMPAIGN_UPDATED = "CAMPAIGN_UPDATED",
  // Admin
  ADMIN_LOGIN = "ADMIN_LOGIN",
  ADMIN_LOGOUT = "ADMIN_LOGOUT",
  ADMIN_USER_CREATED = "ADMIN_USER_CREATED",
  ADMIN_USER_UPDATED = "ADMIN_USER_UPDATED",
  ADMIN_ROLE_CHANGED = "ADMIN_ROLE_CHANGED",
  // Customer
  CUSTOMER_SUSPENDED = "CUSTOMER_SUSPENDED",
  CUSTOMER_BANNED = "CUSTOMER_BANNED",
}


