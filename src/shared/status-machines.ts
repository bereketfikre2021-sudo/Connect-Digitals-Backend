/**
 * Status machine transition rules.
 *
 * These are the canonical allowed transitions for each status enum.
 * Used by the API to validate status changes server-side.
 * Also used in unit tests to verify the machines are complete and correct.
 */

import { OrderStatus, PaymentStatus, FulfillmentStatus } from "./enums.js";

// ---------------------------------------------------------------------------
// Order status transitions
// ---------------------------------------------------------------------------

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.PAYMENT_SUBMITTED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_SUBMITTED]: [
    OrderStatus.PAYMENT_APPROVED,
    OrderStatus.PAYMENT_REJECTED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_APPROVED]: [
    OrderStatus.PROCESSING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAYMENT_REJECTED]: [
    OrderStatus.PENDING_PAYMENT, // customer re-submits
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PROCESSING]: [
    OrderStatus.IN_PROGRESS,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.IN_PROGRESS]: [
    OrderStatus.COMPLETED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.COMPLETED]: [
    OrderStatus.REFUNDED,
  ],
  [OrderStatus.CANCELLED]: [
    OrderStatus.REFUNDED,
  ],
  [OrderStatus.REFUNDED]: [],
};

// ---------------------------------------------------------------------------
// Payment status transitions
// ---------------------------------------------------------------------------

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.UNDER_REVIEW,
  ],
  [PaymentStatus.UNDER_REVIEW]: [
    PaymentStatus.APPROVED,
    PaymentStatus.REJECTED,
  ],
  [PaymentStatus.APPROVED]: [
    PaymentStatus.REFUNDED,
  ],
  [PaymentStatus.REJECTED]: [],
  [PaymentStatus.REFUNDED]: [],
};

// ---------------------------------------------------------------------------
// Fulfillment status transitions
// ---------------------------------------------------------------------------

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  [FulfillmentStatus.PENDING]: [
    FulfillmentStatus.QUEUED,
    FulfillmentStatus.AWAITING_APPROVAL,
    FulfillmentStatus.CANCELLED,
  ],
  [FulfillmentStatus.QUEUED]: [
    FulfillmentStatus.PROCESSING,
    FulfillmentStatus.CANCELLED,
  ],
  [FulfillmentStatus.AWAITING_APPROVAL]: [
    FulfillmentStatus.PROCESSING,
    FulfillmentStatus.CANCELLED,
  ],
  [FulfillmentStatus.PROCESSING]: [
    FulfillmentStatus.COMPLETED,
    FulfillmentStatus.FAILED,
    FulfillmentStatus.CANCELLED,
  ],
  [FulfillmentStatus.COMPLETED]: [],
  [FulfillmentStatus.FAILED]: [
    FulfillmentStatus.QUEUED,  // admin can re-queue
    FulfillmentStatus.CANCELLED,
  ],
  [FulfillmentStatus.CANCELLED]: [],
};

// ---------------------------------------------------------------------------
// Generic transition validator
// ---------------------------------------------------------------------------

/**
 * Returns true if transitioning from `from` to `to` is allowed.
 */
export function isValidTransition<T extends string>(
  transitions: Record<T, T[]>,
  from: T,
  to: T
): boolean {
  const allowed = transitions[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertValidTransition<T extends string>(
  transitions: Record<T, T[]>,
  from: T,
  to: T,
  entityName: string
): void {
  if (!isValidTransition(transitions, from, to)) {
    throw new Error(
      `Invalid ${entityName} status transition: ${from} → ${to}`
    );
  }
}


