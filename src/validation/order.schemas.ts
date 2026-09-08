import { z } from "zod";
import { TargetType } from "../shared/index.js";
import { cuidSchema, urlSchema } from "./common.js";

export const createOrderSchema = z.object({
  packageId: cuidSchema,
  // targetUrl is optional at the schema level — the service layer enforces
  // requiresTargetUrl based on the service record.  An empty string is
  // treated the same as absent so the frontend can safely send "" when no
  // URL is needed without triggering a validation error here.
  targetUrl: urlSchema
    .optional()
    .or(z.literal(""))
    .transform((v) => (v === "" ? undefined : v)),
  targetType: z.nativeEnum(TargetType),
  notes: z.string().max(500).optional(),
  // promoCode is accepted and forwarded to the service layer.
  // Silently ignored when no promotion system is active.
  promoCode: z.string().max(50).toUpperCase().optional(),
});

export const orderIdSchema = z.object({
  orderId: cuidSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;


