import { z } from "zod";

const cloudFrontCookieSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  domain: z.string().min(1).optional(),
  path: z.string().min(1).default("/"),
  secure: z.boolean().default(true),
  httpOnly: z.boolean().default(true),
  sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]).default("no_restriction"),
  expirationDate: z.number().positive().optional(),
});

export const privateUpdateAuthResponseSchema = z.object({
  baseUrl: z.string().url(),
  expiresAt: z.string().datetime().optional(),
  cookies: z.array(cloudFrontCookieSchema).default([]),
});

export type PrivateUpdateAuthResponse = z.infer<typeof privateUpdateAuthResponseSchema>;
export type CloudFrontCookieDescriptor = z.infer<typeof cloudFrontCookieSchema>;
