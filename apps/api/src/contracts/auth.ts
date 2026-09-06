import { z } from "zod";

export const userResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().url().nullable(),
});

export const authSessionResponseSchema = z.object({
  authenticated: z.boolean(),
  user: userResponseSchema.nullable(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
