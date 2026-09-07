/**
 * Unit tests — Payment proof file validation
 *
 * Tests the validateUploadBuffer function in isolation.
 * Covers magic byte detection, MIME type enforcement, and size limits.
 */

import { describe, it, expect } from "vitest";
import { validateUploadBuffer, UploadValidationError } from "../../src/lib/upload-validator.ts";
import { MAX_PAYMENT_PROOF_SIZE_BYTES } from "@cdpromo/shared";

// Use UploadValidationError as the expected error type (no env dependency)
const AppError = UploadValidationError;

// ── Magic byte helpers ────────────────────────────────────────────────────────

function makeJpegBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0xff; buf[1] = 0xd8; // JPEG SOI marker
  return buf;
}

function makePngBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; // PNG signature
  return buf;
}

function makeWebpBuffer(): Buffer {
  const buf = Buffer.alloc(16);
  buf[0] = 0x52; buf[1] = 0x49; buf[2] = 0x46; buf[3] = 0x46; // RIFF
  return buf;
}

function makeTextBuffer(): Buffer {
  return Buffer.from("this is not an image file at all");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validateUploadBuffer", () => {

  describe("accepts valid image types", () => {
    it("accepts a valid JPEG buffer", () => {
      expect(() =>
        validateUploadBuffer(makeJpegBuffer(), "image/jpeg", 100)
      ).not.toThrow();
    });

    it("accepts a valid PNG buffer", () => {
      expect(() =>
        validateUploadBuffer(makePngBuffer(), "image/png", 100)
      ).not.toThrow();
    });

    it("accepts a valid WebP buffer", () => {
      expect(() =>
        validateUploadBuffer(makeWebpBuffer(), "image/webp", 100)
      ).not.toThrow();
    });
  });

  describe("rejects invalid MIME types", () => {
    it("rejects image/gif", () => {
      expect(() =>
        validateUploadBuffer(makeJpegBuffer(), "image/gif", 100)
      ).toThrow(AppError);
    });

    it("rejects application/pdf", () => {
      expect(() =>
        validateUploadBuffer(makeJpegBuffer(), "application/pdf", 100)
      ).toThrow(AppError);
    });

    it("rejects text/plain", () => {
      expect(() =>
        validateUploadBuffer(makeTextBuffer(), "text/plain", 100)
      ).toThrow(AppError);
    });

    it("throws INVALID_FILE_TYPE code for bad MIME", () => {
      try {
        validateUploadBuffer(makeJpegBuffer(), "image/gif", 100);
        throw new Error("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("INVALID_FILE_TYPE");
      }
    });
  });

  describe("rejects files with wrong magic bytes", () => {
    it("rejects a plain text buffer even with image/jpeg MIME", () => {
      expect(() =>
        validateUploadBuffer(makeTextBuffer(), "image/jpeg", 100)
      ).toThrow(AppError);
    });

    it("throws INVALID_FILE_CONTENT code for magic byte mismatch", () => {
      try {
        validateUploadBuffer(makeTextBuffer(), "image/jpeg", 100);
        throw new Error("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("INVALID_FILE_CONTENT");
      }
    });
  });

  describe("enforces file size limit", () => {
    it("rejects files over 10MB", () => {
      expect(() =>
        validateUploadBuffer(makeJpegBuffer(), "image/jpeg", MAX_PAYMENT_PROOF_SIZE_BYTES + 1)
      ).toThrow(AppError);
    });

    it("throws FILE_TOO_LARGE code", () => {
      try {
        validateUploadBuffer(makeJpegBuffer(), "image/jpeg", MAX_PAYMENT_PROOF_SIZE_BYTES + 1);
        throw new Error("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe("FILE_TOO_LARGE");
      }
    });

    it("accepts a file exactly at the size limit", () => {
      expect(() =>
        validateUploadBuffer(makeJpegBuffer(), "image/jpeg", MAX_PAYMENT_PROOF_SIZE_BYTES)
      ).not.toThrow();
    });

    it("size is checked before magic bytes — FILE_TOO_LARGE takes priority", () => {
      try {
        validateUploadBuffer(makeTextBuffer(), "image/jpeg", MAX_PAYMENT_PROOF_SIZE_BYTES + 1);
        throw new Error("expected to throw");
      } catch (err) {
        expect((err as AppError).code).toBe("FILE_TOO_LARGE");
      }
    });
  });
});


