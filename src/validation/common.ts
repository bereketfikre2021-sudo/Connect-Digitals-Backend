import { z } from "zod";

/** UUID v4 string */
export const uuidSchema = z.string().uuid();

/** Positive integer (quantities, amounts in cents) */
export const positiveInt = z.number().int().positive();

/** Non-negative integer (balances) */
export const nonNegativeInt = z.number().int().min(0);

/** Safe URL */
export const urlSchema = z
  .string()
  .url()
  .max(2048, "URL must be 2048 characters or fewer");

/** Pagination */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});


