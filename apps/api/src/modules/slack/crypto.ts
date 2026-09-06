import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "../../config/env.js";

const algorithm = "aes-256-gcm";

const encryptionKey = (): Buffer => {
  if (!env.SLACK_TOKEN_ENCRYPTION_KEY) {
    throw new Error("SLACK_TOKEN_ENCRYPTION_KEY must be configured for Slack OAuth.");
  }
  return Buffer.from(env.SLACK_TOKEN_ENCRYPTION_KEY, "hex");
};

export const encryptSlackToken = (token: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
};

export const decryptSlackToken = (value: string): string => {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded)
    throw new Error("Invalid encrypted Slack token.");
  const decipher = createDecipheriv(
    algorithm,
    encryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
