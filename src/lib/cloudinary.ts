/**
 * Storage service — payment proof upload and signed URL generation.
 * Uses Supabase Storage (private bucket) instead of Cloudinary.
 *
 * Files are uploaded to the PAYMENT_PROOFS_BUCKET which must be configured
 * as a PRIVATE bucket in Supabase — public access is disabled.
 * Access is only via time-limited signed URLs generated server-side.
 *
 * Named cloudinary.ts intentionally to avoid changing all import paths.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { AppError } from "../middleware/error.js";
import { randomUUID } from "crypto";

// Re-export pure validator (no env dependency — safe for unit tests)
export { validateUploadBuffer, UploadValidationError } from "./upload-validator.js";

const BUCKET = "payment-proofs";

export const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

// Service-role client factory — server-side only, never sent to the browser
function getStorage() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AppError(500, "STORAGE_NOT_CONFIGURED", "Supabase storage is not configured");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  }).storage;
}

export interface UploadResult {
  publicId: string;  // Storage path — used as the key everywhere screenshotKey is stored
  secureUrl: string; // Short-lived signed URL (1 hour)
  format: string;
  bytes: number;
}

/**
 * Uploads a payment proof buffer to Supabase Storage (private bucket).
 */
export async function uploadPaymentProof(
  buffer: Buffer,
  userId: string
): Promise<UploadResult> {
  const storage = getStorage();
  const storagePath = `${userId}/${randomUUID()}.jpg`;

  const { error } = await storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });

  if (error) {
    throw new AppError(500, "UPLOAD_FAILED", `Failed to upload payment proof: ${error.message}`);
  }

  const signedUrl = await getSignedProofUrl(storagePath);

  return { publicId: storagePath, secureUrl: signedUrl, format: "jpg", bytes: buffer.length };
}

/**
 * Generates a signed, time-limited URL for a private payment proof.
 * Call server-side only for verified admin/owner access.
 */
export async function getSignedProofUrl(
  publicId: string,
  expiresIn = 3600
): Promise<string> {
  const storage = getStorage();
  const { data, error } = await storage.from(BUCKET).createSignedUrl(publicId, expiresIn);

  if (error || !data?.signedUrl) {
    throw new AppError(500, "SIGNED_URL_FAILED", "Failed to generate signed URL for payment proof");
  }

  return data.signedUrl;
}

/**
 * Deletes a payment proof from storage.
 */
export async function deletePaymentProof(publicId: string): Promise<void> {
  try {
    const storage = getStorage();
    await storage.from(BUCKET).remove([publicId]);
  } catch {
    // Log but don't throw — deletion failure is not critical
  }
}


