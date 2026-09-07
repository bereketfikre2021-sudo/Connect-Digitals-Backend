/**
 * Unit tests — Status machine transition validators
 *
 * Verifies that every defined transition is allowed, and that
 * invalid/reverse transitions are correctly rejected.
 */

import { describe, it, expect } from "vitest";
import {
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  FULFILLMENT_TRANSITIONS,
  isValidTransition,
  assertValidTransition,
} from "../../src/shared/status-machines.ts";
import {
  OrderStatus,
  PaymentStatus,
  FulfillmentStatus,
} from "../../src/shared/enums.ts";

// ---------------------------------------------------------------------------
// Order status machine
// ---------------------------------------------------------------------------

describe("Order status machine", () => {
  it("allows PENDING_PAYMENT → PAYMENT_SUBMITTED", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_SUBMITTED)
    ).toBe(true);
  });

  it("allows PENDING_PAYMENT → CANCELLED", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED)
    ).toBe(true);
  });

  it("allows PAYMENT_SUBMITTED → PAYMENT_APPROVED", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PAYMENT_SUBMITTED, OrderStatus.PAYMENT_APPROVED)
    ).toBe(true);
  });

  it("allows PAYMENT_SUBMITTED → PAYMENT_REJECTED", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PAYMENT_SUBMITTED, OrderStatus.PAYMENT_REJECTED)
    ).toBe(true);
  });

  it("allows PAYMENT_APPROVED → PROCESSING", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PAYMENT_APPROVED, OrderStatus.PROCESSING)
    ).toBe(true);
  });

  it("allows PAYMENT_REJECTED → PENDING_PAYMENT (re-submit)", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PAYMENT_REJECTED, OrderStatus.PENDING_PAYMENT)
    ).toBe(true);
  });

  it("allows PROCESSING → IN_PROGRESS", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PROCESSING, OrderStatus.IN_PROGRESS)
    ).toBe(true);
  });

  it("allows IN_PROGRESS → COMPLETED", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.IN_PROGRESS, OrderStatus.COMPLETED)
    ).toBe(true);
  });

  it("allows COMPLETED → REFUNDED", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.COMPLETED, OrderStatus.REFUNDED)
    ).toBe(true);
  });

  it("allows CANCELLED → REFUNDED", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.CANCELLED, OrderStatus.REFUNDED)
    ).toBe(true);
  });

  it("rejects REFUNDED → any (terminal state)", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(
        isValidTransition(ORDER_TRANSITIONS, OrderStatus.REFUNDED, status)
      ).toBe(false);
    }
  });

  it("rejects COMPLETED → IN_PROGRESS (backwards)", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.COMPLETED, OrderStatus.IN_PROGRESS)
    ).toBe(false);
  });

  it("rejects PENDING_PAYMENT → COMPLETED (skipping steps)", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PENDING_PAYMENT, OrderStatus.COMPLETED)
    ).toBe(false);
  });

  it("rejects PROCESSING → PAYMENT_SUBMITTED (backwards)", () => {
    expect(
      isValidTransition(ORDER_TRANSITIONS, OrderStatus.PROCESSING, OrderStatus.PAYMENT_SUBMITTED)
    ).toBe(false);
  });

  it("all OrderStatus values are present as keys in ORDER_TRANSITIONS", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(ORDER_TRANSITIONS).toHaveProperty(status);
    }
  });
});

// ---------------------------------------------------------------------------
// Payment status machine
// ---------------------------------------------------------------------------

describe("Payment status machine", () => {
  it("allows PENDING → UNDER_REVIEW", () => {
    expect(
      isValidTransition(PAYMENT_TRANSITIONS, PaymentStatus.PENDING, PaymentStatus.UNDER_REVIEW)
    ).toBe(true);
  });

  it("allows UNDER_REVIEW → APPROVED", () => {
    expect(
      isValidTransition(PAYMENT_TRANSITIONS, PaymentStatus.UNDER_REVIEW, PaymentStatus.APPROVED)
    ).toBe(true);
  });

  it("allows UNDER_REVIEW → REJECTED", () => {
    expect(
      isValidTransition(PAYMENT_TRANSITIONS, PaymentStatus.UNDER_REVIEW, PaymentStatus.REJECTED)
    ).toBe(true);
  });

  it("allows APPROVED → REFUNDED", () => {
    expect(
      isValidTransition(PAYMENT_TRANSITIONS, PaymentStatus.APPROVED, PaymentStatus.REFUNDED)
    ).toBe(true);
  });

  it("rejects REJECTED → any (terminal state)", () => {
    for (const status of Object.values(PaymentStatus)) {
      expect(
        isValidTransition(PAYMENT_TRANSITIONS, PaymentStatus.REJECTED, status)
      ).toBe(false);
    }
  });

  it("rejects REFUNDED → any (terminal state)", () => {
    for (const status of Object.values(PaymentStatus)) {
      expect(
        isValidTransition(PAYMENT_TRANSITIONS, PaymentStatus.REFUNDED, status)
      ).toBe(false);
    }
  });

  it("rejects PENDING → APPROVED (skipping UNDER_REVIEW)", () => {
    expect(
      isValidTransition(PAYMENT_TRANSITIONS, PaymentStatus.PENDING, PaymentStatus.APPROVED)
    ).toBe(false);
  });

  it("all PaymentStatus values are present as keys in PAYMENT_TRANSITIONS", () => {
    for (const status of Object.values(PaymentStatus)) {
      expect(PAYMENT_TRANSITIONS).toHaveProperty(status);
    }
  });
});

// ---------------------------------------------------------------------------
// Fulfillment status machine
// ---------------------------------------------------------------------------

describe("Fulfillment status machine", () => {
  it("allows PENDING → QUEUED", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.PENDING, FulfillmentStatus.QUEUED)
    ).toBe(true);
  });

  it("allows PENDING → AWAITING_APPROVAL", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.PENDING, FulfillmentStatus.AWAITING_APPROVAL)
    ).toBe(true);
  });

  it("allows QUEUED → PROCESSING", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.QUEUED, FulfillmentStatus.PROCESSING)
    ).toBe(true);
  });

  it("allows AWAITING_APPROVAL → PROCESSING", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.AWAITING_APPROVAL, FulfillmentStatus.PROCESSING)
    ).toBe(true);
  });

  it("allows PROCESSING → COMPLETED", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.PROCESSING, FulfillmentStatus.COMPLETED)
    ).toBe(true);
  });

  it("allows PROCESSING → FAILED", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.PROCESSING, FulfillmentStatus.FAILED)
    ).toBe(true);
  });

  it("allows FAILED → QUEUED (admin re-queue)", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.FAILED, FulfillmentStatus.QUEUED)
    ).toBe(true);
  });

  it("rejects COMPLETED → any (terminal state)", () => {
    for (const status of Object.values(FulfillmentStatus)) {
      expect(
        isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.COMPLETED, status)
      ).toBe(false);
    }
  });

  it("rejects CANCELLED → any (terminal state)", () => {
    for (const status of Object.values(FulfillmentStatus)) {
      expect(
        isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.CANCELLED, status)
      ).toBe(false);
    }
  });

  it("rejects PROCESSING → PENDING (backwards)", () => {
    expect(
      isValidTransition(FULFILLMENT_TRANSITIONS, FulfillmentStatus.PROCESSING, FulfillmentStatus.PENDING)
    ).toBe(false);
  });

  it("all FulfillmentStatus values are present as keys in FULFILLMENT_TRANSITIONS", () => {
    for (const status of Object.values(FulfillmentStatus)) {
      expect(FULFILLMENT_TRANSITIONS).toHaveProperty(status);
    }
  });
});

// ---------------------------------------------------------------------------
// assertValidTransition helper
// ---------------------------------------------------------------------------

describe("assertValidTransition", () => {
  it("does not throw for a valid transition", () => {
    expect(() =>
      assertValidTransition(
        ORDER_TRANSITIONS,
        OrderStatus.PENDING_PAYMENT,
        OrderStatus.PAYMENT_SUBMITTED,
        "Order"
      )
    ).not.toThrow();
  });

  it("throws an error for an invalid transition", () => {
    expect(() =>
      assertValidTransition(
        ORDER_TRANSITIONS,
        OrderStatus.COMPLETED,
        OrderStatus.PENDING_PAYMENT,
        "Order"
      )
    ).toThrow("Invalid Order status transition");
  });

  it("error message includes from and to states", () => {
    expect(() =>
      assertValidTransition(
        PAYMENT_TRANSITIONS,
        PaymentStatus.REJECTED,
        PaymentStatus.APPROVED,
        "Payment"
      )
    ).toThrow("REJECTED → APPROVED");
  });
});


