/**
 * Unit tests — Wallet arithmetic and balance rules
 *
 * Tests the financial calculation logic in isolation.
 * Does NOT touch the database — pure logic tests.
 */

import { describe, it, expect } from "vitest";

// ── Pure helpers we can test without a DB ────────────────────────────────────

function computeBalanceAfterCredit(before: number, amount: number): number {
  if (amount <= 0) throw new Error("Amount must be positive");
  return before + amount;
}

function computeBalanceAfterDebit(before: number, amount: number): number {
  if (amount <= 0) throw new Error("Amount must be positive");
  if (before < amount) throw new Error("Insufficient balance");
  return before - amount;
}

function etbCentsFromEtb(etb: number): number {
  return Math.round(etb * 100);
}

function etbFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Wallet credit arithmetic", () => {
  it("adds amount to balance correctly", () => {
    expect(computeBalanceAfterCredit(10000, 5000)).toBe(15000);
  });

  it("adds to a zero balance", () => {
    expect(computeBalanceAfterCredit(0, 5000)).toBe(5000);
  });

  it("handles large amounts correctly", () => {
    expect(computeBalanceAfterCredit(100000_00, 50000_00)).toBe(150000_00);
  });

  it("rejects zero credit amount", () => {
    expect(() => computeBalanceAfterCredit(10000, 0)).toThrow("Amount must be positive");
  });

  it("rejects negative credit amount", () => {
    expect(() => computeBalanceAfterCredit(10000, -100)).toThrow("Amount must be positive");
  });
});

describe("Wallet debit arithmetic", () => {
  it("subtracts amount from balance correctly", () => {
    expect(computeBalanceAfterDebit(10000, 3000)).toBe(7000);
  });

  it("allows debit of the full balance", () => {
    expect(computeBalanceAfterDebit(5000, 5000)).toBe(0);
  });

  it("rejects debit greater than balance — no negative balance", () => {
    expect(() => computeBalanceAfterDebit(3000, 5000)).toThrow("Insufficient balance");
  });

  it("rejects debit from zero balance", () => {
    expect(() => computeBalanceAfterDebit(0, 100)).toThrow("Insufficient balance");
  });

  it("rejects zero debit amount", () => {
    expect(() => computeBalanceAfterDebit(10000, 0)).toThrow("Amount must be positive");
  });

  it("rejects negative debit amount", () => {
    expect(() => computeBalanceAfterDebit(10000, -100)).toThrow("Amount must be positive");
  });

  it("balance is exactly zero — not negative — after full debit", () => {
    const result = computeBalanceAfterDebit(1000, 1000);
    expect(result).toBe(0);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe("ETB currency conversion", () => {
  it("converts 100 ETB to 10000 cents", () => {
    expect(etbCentsFromEtb(100)).toBe(10000);
  });

  it("converts 0.50 ETB to 50 cents", () => {
    expect(etbCentsFromEtb(0.50)).toBe(50);
  });

  it("converts 1.99 ETB to 199 cents without floating point error", () => {
    expect(etbCentsFromEtb(1.99)).toBe(199);
  });

  it("displays 10000 cents as 100.00 ETB", () => {
    expect(etbFromCents(10000)).toBe("100.00");
  });

  it("displays 50 cents as 0.50 ETB", () => {
    expect(etbFromCents(50)).toBe("0.50");
  });

  it("displays 0 cents as 0.00 ETB", () => {
    expect(etbFromCents(0)).toBe("0.00");
  });
});

describe("Wallet transaction sequence integrity", () => {
  it("balanceBefore + amount = balanceAfter for a credit", () => {
    const before = 10000;
    const amount = 5000;
    const after = computeBalanceAfterCredit(before, amount);
    expect(before + amount).toBe(after);
  });

  it("balanceBefore - amount = balanceAfter for a debit", () => {
    const before = 10000;
    const amount = 3000;
    const after = computeBalanceAfterDebit(before, amount);
    expect(before - amount).toBe(after);
  });

  it("sequential credits accumulate correctly", () => {
    let balance = 0;
    const amounts = [5000, 10000, 2500, 7500];
    for (const amt of amounts) {
      balance = computeBalanceAfterCredit(balance, amt);
    }
    expect(balance).toBe(25000);
  });

  it("sequential debits reduce correctly and stop at zero", () => {
    let balance = 20000;
    balance = computeBalanceAfterDebit(balance, 5000);
    balance = computeBalanceAfterDebit(balance, 8000);
    balance = computeBalanceAfterDebit(balance, 7000);
    expect(balance).toBe(0);
    // Next debit must fail
    expect(() => computeBalanceAfterDebit(balance, 1)).toThrow("Insufficient balance");
  });
});


