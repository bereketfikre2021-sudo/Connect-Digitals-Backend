/**
 * Supabase server-side client factory.
 *
 * Two clients:
 *
 * 1. getServiceClient() — uses the SERVICE ROLE key.
 *    Can bypass RLS. Use only for:
 *      - creating/updating Supabase Auth users (Telegram upsert)
 *      - Storage signed URL generation
 *    Never send to browser. Never log.
 *
 * 2. getUserFromToken(token) — validates a Supabase access token
 *    and returns the authenticated user. Used in every request middleware.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/** Service-role client — server-side only */
export function getServiceClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service credentials are not configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Anon client used purely to validate user-supplied access tokens */
function getAnonClient() {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase anon credentials are not configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface SupabaseUserInfo {
  id: string;          // Supabase Auth UUID
  email?: string;
  metadata: Record<string, unknown>;
}

/**
 * Validates a Supabase access token (Bearer) sent by the client.
 * Returns the user if the token is valid, throws otherwise.
 *
 * Uses the anon client so the service-role key is never used for
 * per-request validation.
 */
export async function getUserFromToken(token: string): Promise<SupabaseUserInfo> {
  const client = getAnonClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new Error("INVALID_TOKEN");
  }
  return {
    id: data.user.id,
    email: data.user.email,
    metadata: (data.user.user_metadata ?? {}) as Record<string, unknown>,
  };
}


