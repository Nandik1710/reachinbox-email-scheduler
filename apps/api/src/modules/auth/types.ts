export interface AuthUser {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface GoogleUserInput {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface UserRepository {
  upsertGoogleUser(input: GoogleUserInput): Promise<AuthUser>;
  findById(id: string): Promise<AuthUser | null>;
}

declare global {
  // Passport exposes its request user through the Express namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      id: string;
      googleId: string;
      email: string;
      name: string;
      avatarUrl: string | null;
    }
  }
}

export {};
