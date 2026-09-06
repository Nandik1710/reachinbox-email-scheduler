import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../db/client.js";
import type { AuthUser, GoogleUserInput, UserRepository } from "./types.js";

const toAuthUser = (user: {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}): AuthUser => ({
  id: user.id,
  googleId: user.googleId,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl,
});

export const createPrismaUserRepository = (client: PrismaClient = prisma): UserRepository => ({
  async upsertGoogleUser(input: GoogleUserInput): Promise<AuthUser> {
    const user = await client.user.upsert({
      where: { googleId: input.googleId },
      create: input,
      update: {
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl,
      },
    });

    return toAuthUser(user);
  },

  async findById(id: string): Promise<AuthUser | null> {
    const user = await client.user.findUnique({ where: { id } });
    return user ? toAuthUser(user) : null;
  },
});
