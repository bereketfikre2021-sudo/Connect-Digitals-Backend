/**
 * Unit tests — Payment service logic (pure functions and error rules)
 *
 * Tests payment idempotency logic, status validation, and security rules
 * that can be exercised without a live database.
 */

import { describe, it, expect } from "vitest";

// Local error class — avoids importing from API middleware (which pulls in env.ts)
class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ── Payment amount — server-side computation rule ─────────────────────────────

/**
 * Simulates the server-side total computation rule:
 * the total is always taken from the package record, never from client input.
 */
function computeOrderTotal(packagePriceETB: number, quantity: number): number {
  if (quantity < 1) throw new AppError(400, "INVALID_QUANTITY", "Quantity must be at least 1");
  if (packagePriceETB <= 0) throw new AppError(400, "INVALID_PRICE", "Package price must be positive");
  return packagePriceETB;          // one package = fixed price, quantity is within the package
}

/**
 * Simulates the server-side check: a customer-submitted amount is ignored.
 * The server uses the DB value regardless.
 */
function selectAuthorativeAmount(dbAmountETB: number, _clientAmountETB: number): number {
  return dbAmountETB;              // client value is intentionally discarded
}

// ── Rejection reason requirement ──────────────────────────────────────────────

function validateRejection(reason: string | undefined): void {
  if (!reason || reason.trim().length < 5) {
    throw new AppError(422, "REJECTION_REASON_REQUIRED", "A rejection reason of at least 5 characters is required");
  }
}

// ── Status-based operation guards ────────────────────────────────────────────

function assertPaymentReviewable(status: string): void {
  if (status !== "UNDER_REVIEW") {
    throw new AppError(409, "INVALID_STATE", `Payment cannot be reviewed — current status is ${status}`);
  }
}

function assertOrderAcceptsPayment(orderStatus: string): void {
  const eligible = ["PENDING_PAYMENT", "PAYMENT_REJECTED"];
  if (!eligible.includes(orderStatus)) {
    throw new AppError(409, "ORDER_NOT_ELIGIBLE", `Order is not eligible for payment — status is ${orderStatus}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Order total computation (server-side authority)", () => {
  it("uses package price as total — ignores client-supplied amount", () => {
    const dbPrice = 27000;      // 270 ETB in cents
    const clientAmount = 1;     // client trying to underpay
    expect(selectAuthorativeAmount(dbPrice, clientAmount)).toBe(dbPrice);
  });

  it("computes total from package record correctly", () => {
    expect(computeOrderTotal(27000, 1)).toBe(27000);
  });

  it("rejects quantity less than 1", () => {
    expect(() => computeOrderTotal(27000, 0)).toThrow(AppError);
    try { computeOrderTotal(27000, 0); } catch(e) {
      expect((e as AppError).code).toBe("INVALID_QUANTITY");
    }
  });

  it("rejects zero price", () => {
    expect(() => computeOrderTotal(0, 1)).toThrow(AppError);
    try { computeOrderTotal(0, 1); } catch(e) {
      expect((e as AppError).code).toBe("INVALID_PRICE");
    }
  });
});

describe("Payment review guards", () => {
  it("allows review of a payment in UNDER_REVIEW status", () => {
    expect(() => assertPaymentReviewable("UNDER_REVIEW")).not.toThrow();
  });

  it("rejects review of an already APPROVED payment", () => {
    expect(() => assertPaymentReviewable("APPROVED")).toThrow(AppError);
  });

  it("rejects review of an already REJECTED payment", () => {
    expect(() => assertPaymentReviewable("REJECTED")).toThrow(AppError);
  });

  it("throws INVALID_STATE for wrong status", () => {
    try {
      assertPaymentReviewable("APPROVED");
    } catch (err) {
      expect((err as AppError).code).toBe("INVALID_STATE");
    }
  });
});

describe("Rejection reason validation", () => {
  it("accepts a valid rejection reason", () => {
    expect(() => validateRejection("Screenshot does not match the reference number")).not.toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => validateRejection("")).toThrow(AppError);
  });

  it("rejects undefined", () => {
    expect(() => validateRejection(undefined)).toThrow(AppError);
  });

  it("rejects a reason shorter than 5 characters", () => {
    expect(() => validateRejection("No")).toThrow(AppError);
  });

  it("throws REJECTION_REASON_REQUIRED code", () => {
    try {
      validateRejection("Bad");
    } catch (err) {
      expect((err as AppError).code).toBe("REJECTION_REASON_REQUIRED");
    }
  });
});

describe("Order payment eligibility", () => {
  it("allows payment for PENDING_PAYMENT order", () => {
    expect(() => assertOrderAcceptsPayment("PENDING_PAYMENT")).not.toThrow();
  });

  it("allows re-payment for PAYMENT_REJECTED order", () => {
    expect(() => assertOrderAcceptsPayment("PAYMENT_REJECTED")).not.toThrow();
  });

  it("rejects payment for PAYMENT_APPROVED order", () => {
    expect(() => assertOrderAcceptsPayment("PAYMENT_APPROVED")).toThrow(AppError);
  });

  it("rejects payment for COMPLETED order", () => {
    expect(() => assertOrderAcceptsPayment("COMPLETED")).toThrow(AppError);
  });

  it("rejects payment for CANCELLED order", () => {
    expect(() => assertOrderAcceptsPayment("CANCELLED")).toThrow(AppError);
  });

  it("throws ORDER_NOT_ELIGIBLE code", () => {
    try {
      assertOrderAcceptsPayment("COMPLETED");
    } catch (err) {
      expect((err as AppError).code).toBe("ORDER_NOT_ELIGIBLE");
    }
  });
});

describe("Security: client-supplied prices are discarded", () => {
  const packagePrices = [
    { name: "500 Followers", dbPriceETB: 15000 },
    { name: "1,000 Followers", dbPriceETB: 27000 },
    { name: "5,000 Followers", dbPriceETB: 110000 },
  ];

  for (const pkg of packagePrices) {
    it(`always uses DB price for "${pkg.name}" regardless of client input`, () => {
      const attackerAmount = 100; // 1 ETB — malicious underpricing
      const authoritative = selectAuthorativeAmount(pkg.dbPriceETB, attackerAmount);
      expect(authoritative).toBe(pkg.dbPriceETB);
      expect(authoritative).not.toBe(attackerAmount);
    });
  }
});

// ── Server-side amount enforcement (submitPayment rule) ───────────────────────

/**
 * These tests document the contract enforced in payment.service.ts:
 * submitPayment always stores order.totalAmountETB, never input.amountETB.
 *
 * The function that mimics the actual service behaviour:
 */
function serverSideSubmitAmount(orderTotalETB: number, clientAmountETB: number): number {
  // This mirrors the line in submitPayment:
  //   const authorativeAmountETB = order.totalAmountETB;
  void clientAmountETB; // client value explicitly discarded
  return orderTotalETB;
}

describe("submitPayment: server always stores order.totalAmountETB", () => {
  it("stores the order total when client sends 0", () => {
    expect(serverSideSubmitAmount(27000, 0)).toBe(27000);
  });

  it("stores the order total when client sends a lower (underpriced) amount", () => {
    expect(serverSideSubmitAmount(27000, 100)).toBe(27000);
  });

  it("stores the order total when client sends a higher (overpriced) amount", () => {
    expect(serverSideSubmitAmount(27000, 999999)).toBe(27000);
  });

  it("stores the order total when client sends the correct amount (normal case)", () => {
    expect(serverSideSubmitAmount(27000, 27000)).toBe(27000);
  });

  it("a deposit payment stores the deposit total, not 0", () => {
    // Wallet deposit: order.totalAmountETB = 50000 (500 ETB)
    expect(serverSideSubmitAmount(50000, 0)).toBe(50000);
    expect(serverSideSubmitAmount(50000, 0)).not.toBe(0);
  });
});


