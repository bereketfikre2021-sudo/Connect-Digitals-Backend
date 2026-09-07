import { z } from "zod";
import { uuidSchema, positiveInt } from "./common.js";

export const submitPaymentSchema = z.object({
  orderId: uuidSchema,
  paymentMethodId: uuidSchema,
  amount: positiveInt,
  reference: z.string().min(1).max(100).trim(),
  idempotencyKey: uuidSchema,
});

export const reviewPaymentSchema = z.object({
  paymentId: uuidSchema,
  action: z.enum(["APPROVE", "REJECT"]),
  rejectionReason: z.string().min(1).max(500).optional(),
}).refine(
  (data) => data.action !== "REJECT" || !!data.rejectionReason,
  { message: "Rejection reason is required when rejecting a payment", path: ["rejectionReason"] }
);

export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;
export type ReviewPaymentInput = z.infer<typeof reviewPaymentSchema>;


