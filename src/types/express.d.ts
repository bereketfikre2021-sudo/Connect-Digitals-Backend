import type { CustomerRequestIdentity } from "../shared/index.js";

declare global {
  namespace Express {
    interface Request {
      customer?: CustomerRequestIdentity;
      admin?: {
        sub: string;
        supabaseUserId: string;
        role: string;
      };
      // Augmented by multer middleware
      file?: import("multer").Express.Multer.File;
      files?: import("multer").Express.Multer.File[] | { [fieldname: string]: import("multer").Express.Multer.File[] };
    }
  }
}


