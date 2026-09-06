import { Passport } from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

import { env } from "../../config/env.js";
import { isGoogleOAuthConfigured } from "./configuration.js";
import type { UserRepository } from "./types.js";

export type PassportInstance = InstanceType<typeof Passport>;

export const configurePassport = (passport: PassportInstance, users: UserRepository): void => {
  passport.serializeUser((user: Express.User, done: (error: unknown, id?: string) => void) => {
    done(null, user.id);
  });

  passport.deserializeUser(
    async (id: string, done: (error: unknown, user?: Express.User | false | null) => void) => {
      try {
        const user = await users.findById(id);
        done(null, user ?? false);
      } catch (error: unknown) {
        done(error as Error);
      }
    },
  );

  if (!isGoogleOAuthConfigured()) return;

  passport.use(
    "google",
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            done(new Error("Google did not provide an email address."));
            return;
          }

          const user = await users.upsertGoogleUser({
            googleId: profile.id,
            email: email.toLowerCase(),
            name: profile.displayName || email,
            avatarUrl: profile.photos?.[0]?.value ?? null,
          });

          done(null, user);
        } catch (error: unknown) {
          done(error as Error);
        }
      },
    ),
  );
};
