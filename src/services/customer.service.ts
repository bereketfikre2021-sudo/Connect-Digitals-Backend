/**
 * Customer service — upsert Supabase Auth user + app User + TelegramIdentity + Wallet.
 *
 * Session creation strategy:
 * - On first login: create Supabase Auth user with a deterministic password
 *   derived from the Supabase UUID (stored nowhere externally — regenerated on demand).
 * - On subsequent logins: retrieve the existing UUID, regenerate the same password,
 *   sign in with it to get a fresh session.
 *
 * The password is never user-facing. Authentication is always via Telegram initData
 * or the dev-login endpoint (development only).
 */

import { prisma } from "../lib/prisma.js";
import { getServiceClient } from "../lib/supabase.js";
import { createClient } from "@supabase/supabase-js";
import type { TelegramUser } from "../lib/telegram-auth.js";
import type { Session } from "@supabase/supabase-js";
import { createHmac } from "crypto";

export interface UpsertCustomerResult {
  userId: string;
  supabaseUserId: string;
  session: Session;
  isNew: boolean;
}

/**
 * Derives a deterministic password from a Supabase UUID.
 * Uses HMAC-SHA256 with a fixed server-side secret so the password
 * is stable across restarts but unguessable without the secret.
 */
function derivePassword(supabaseUserId: string): string {
  const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "fallback-dev-secret";
  return createHmac("sha256", secret).update(supabaseUserId).digest("hex");
}

/**
 * Signs in to Supabase with the derived password and returns a session.
 */
async function signInWithDerivedPassword(email: string, supabaseUserId: string): Promise<Session> {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase credentials not configured");

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const password = derivePassword(supabaseUserId);
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    throw new Error(`Failed to sign in: ${error?.message}`);
  }

  return data.session;
}

export async function upsertCustomer(
  user: TelegramUser,
  authDate: Date
): Promise<UpsertCustomerResult> {
  const telegramUserId = String(user.id);
  const syntheticEmail = `tg_${telegramUserId}@cdpromo.internal`;

  const supabase = getServiceClient();

  // --- Supabase Auth upsert ---
  const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existingAuthUser = listData?.users.find((u: { email?: string }) => u.email === syntheticEmail);

  let supabaseUserId: string;
  let isNewSupabaseUser = false;

  if (existingAuthUser) {
    supabaseUserId = existingAuthUser.id;
    // Ensure the derived password is set (handles users created before this change)
    await supabase.auth.admin.updateUserById(supabaseUserId, {
      password: derivePassword(supabaseUserId),
    });
  } else {
    // First login — create with the derived password directly.
    // We use a temp UUID to bootstrap since we don't have the real UUID yet.
    // Create with a placeholder, get the real UUID, then update to derived password.
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: syntheticEmail,
      password: "temp-will-be-updated",
      email_confirm: true,
      user_metadata: { telegramUserId, firstName: user.first_name },
    });
    if (error || !created.user) {
      throw new Error(`Failed to create Supabase Auth user: ${error?.message}`);
    }
    supabaseUserId = created.user.id;
    isNewSupabaseUser = true;

    // Now update to the derived password
    await supabase.auth.admin.updateUserById(supabaseUserId, {
      password: derivePassword(supabaseUserId),
    });
  }

  // --- Create session via signInWithPassword ---
  const session = await signInWithDerivedPassword(syntheticEmail, supabaseUserId);

  // --- App-level User record ---
  const existing = await prisma.telegramIdentity.findUnique({
    where: { telegramUserId },
    select: { userId: true },
  });

  if (existing) {
    await prisma.telegramIdentity.update({
      where: { telegramUserId },
      data: {
        username: user.username ?? null,
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        photoUrl: user.photo_url ?? null,
        isPremium: user.is_premium ?? false,
        authDate,
        lastSeenAt: new Date(),
      },
    });
    await prisma.user.update({
      where: { id: existing.userId },
      data: {
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        username: user.username ?? null,
        supabaseUserId,
      },
    });
    return { userId: existing.userId, supabaseUserId, session, isNew: false };
  }

  // New customer — create User + TelegramIdentity + Wallet in one transaction
  const userId = await prisma.$transaction(async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    const newUser = await tx.user.create({
      data: {
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        username: user.username ?? null,
        status: "ACTIVE",
        supabaseUserId,
      },
    });
    await tx.telegramIdentity.create({
      data: {
        userId: newUser.id,
        telegramUserId,
        username: user.username ?? null,
        firstName: user.first_name,
        lastName: user.last_name ?? null,
        photoUrl: user.photo_url ?? null,
        isPremium: user.is_premium ?? false,
        authDate,
        lastSeenAt: new Date(),
      },
    });
    await tx.wallet.create({ data: { userId: newUser.id, balanceETB: 0 } });
    return newUser.id;
  });

  return { userId, supabaseUserId, session, isNew: isNewSupabaseUser };
}
