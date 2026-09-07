import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { validateInitData, TelegramAuthError } from "../../src/lib/telegram-auth.js";

const MOCK_BOT_TOKEN = "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi";

function buildInitData(user: object, authDate: number, token: string = MOCK_BOT_TOKEN, tamperHash = false): string {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user), query_id: "test_query_id" });
  const dataCheckString = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  params.set("hash", tamperHash ? hash.replace(/.$/, "x") : hash);
  return params.toString();
}

function expectAuthError(fn: () => unknown, expectedCode: string) {
  try { fn(); throw new Error("Expected function to throw but it did not"); }
  catch (err) { expect(err).toBeInstanceOf(TelegramAuthError); expect((err as TelegramAuthError).code).toBe(expectedCode); }
}

const VALID_USER = { id: 123456789, first_name: "Test", last_name: "User", username: "testuser" };
const NOW = Math.floor(Date.now() / 1000);

describe("validateInitData", () => {
  it("accepts valid initData with current auth_date", () => {
    const result = validateInitData(buildInitData(VALID_USER, NOW), MOCK_BOT_TOKEN);
    expect(result.user.id).toBe(VALID_USER.id);
  });
  it("rejects empty initData with code EMPTY_INIT_DATA", () => { expectAuthError(() => validateInitData("", MOCK_BOT_TOKEN), "EMPTY_INIT_DATA"); });
  it("rejects initData with no hash field with code MISSING_HASH", () => {
    const p = new URLSearchParams({ auth_date: String(NOW), user: JSON.stringify(VALID_USER) });
    expectAuthError(() => validateInitData(p.toString(), MOCK_BOT_TOKEN), "MISSING_HASH");
  });
  it("rejects tampered hash with code INVALID_HASH", () => { expectAuthError(() => validateInitData(buildInitData(VALID_USER, NOW, MOCK_BOT_TOKEN, true), MOCK_BOT_TOKEN), "INVALID_HASH"); });
  it("rejects initData signed with wrong bot token", () => { expectAuthError(() => validateInitData(buildInitData(VALID_USER, NOW, "9999:Wrong"), MOCK_BOT_TOKEN), "INVALID_HASH"); });
  it("rejects stale initData with code STALE_INIT_DATA", () => { expectAuthError(() => validateInitData(buildInitData(VALID_USER, NOW - 90000), MOCK_BOT_TOKEN), "STALE_INIT_DATA"); });
  it("accepts initData at 24h boundary", () => { expect(() => validateInitData(buildInitData(VALID_USER, NOW - 86390), MOCK_BOT_TOKEN)).not.toThrow(); });
  it("rejects missing user field", () => {
    const p = new URLSearchParams({ auth_date: String(NOW) });
    const sk = createHmac("sha256", "WebAppData").update(MOCK_BOT_TOKEN).digest();
    const h = createHmac("sha256", sk).update(`auth_date=${NOW}`).digest("hex");
    p.set("hash", h);
    expectAuthError(() => validateInitData(p.toString(), MOCK_BOT_TOKEN), "MISSING_USER");
  });
  it("rejects malformed user JSON", () => {
    const p = new URLSearchParams({ auth_date: String(NOW), user: "{bad" });
    const dcs = Array.from(p.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
    const sk = createHmac("sha256","WebAppData").update(MOCK_BOT_TOKEN).digest();
    p.set("hash", createHmac("sha256",sk).update(dcs).digest("hex"));
    expectAuthError(() => validateInitData(p.toString(), MOCK_BOT_TOKEN), "INVALID_USER");
  });
  it("rejects missing auth_date", () => {
    const p = new URLSearchParams({ user: JSON.stringify(VALID_USER) });
    const sk = createHmac("sha256","WebAppData").update(MOCK_BOT_TOKEN).digest();
    p.set("hash", createHmac("sha256",sk).update(`user=${JSON.stringify(VALID_USER)}`).digest("hex"));
    expectAuthError(() => validateInitData(p.toString(), MOCK_BOT_TOKEN), "MISSING_AUTH_DATE");
  });
  it("parses isPremium flag", () => { expect(validateInitData(buildInitData({...VALID_USER,is_premium:true},NOW),MOCK_BOT_TOKEN).user.is_premium).toBe(true); });
  it("returns query_id", () => { expect(validateInitData(buildInitData(VALID_USER,NOW),MOCK_BOT_TOKEN).query_id).toBe("test_query_id"); });
  it("TelegramAuthError has correct code", () => { const e=new TelegramAuthError("msg","CODE"); expect(e.code).toBe("CODE"); });
});
