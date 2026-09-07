/**
 * Shared TypeScript types used across apps and services.
 * These are plain data types — not Prisma model types.
 */

import type { AuditActorType, NotificationEvent } from "./enums.js";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Identity attached to req.customer by the auth middleware */
export interface CustomerRequestIdentity {
  sub: string;          // app User.id
  supabaseUserId: string;
}

/** Identity attached to req.admin by the admin-auth middleware */
export interface AdminRequestIdentity {
  sub: string;          // AdminUser.id
  supabaseUserId: string;
  role: string;
}

// ---------------------------------------------------------------------------
// Notification payloads
// ---------------------------------------------------------------------------

export interface NotificationPayload {
  userId: string;
  event: NotificationEvent;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  actorId?: string;
  actorType: AuditActorType;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// Fulfillment provider interface types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface ProviderRef {
  providerReference: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderStatus {
  status: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderMetrics {
  impressions?: number;
  reach?: number;
  clicks?: number;
  videoViews?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagement?: number;
  conversions?: number;
  spend?: number;
  metadata?: Record<string, unknown>;
}


