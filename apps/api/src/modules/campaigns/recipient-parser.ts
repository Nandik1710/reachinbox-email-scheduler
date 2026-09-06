import { z } from "zod";

import { MAX_RECIPIENT_SOURCE_BYTES } from "../../contracts/campaigns.js";

const emailSchema = z.string().email().max(320);
const headerNames = new Set(["email", "e-mail", "email address", "recipient"]);

export interface RejectedRecipient {
  value: string;
  reason: "invalid_email";
}

export interface RecipientParseResult {
  detected: number;
  accepted: string[];
  rejected: RejectedRecipient[];
  duplicates: number;
}

export class RecipientSourceError extends Error {
  readonly code = "INVALID_RECIPIENT_SOURCE";
  readonly status = 422;

  constructor(message: string) {
    super(message);
    this.name = "RecipientSourceError";
  }
}

const parseCsvRows = (source: string): string[][] => {
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (quoted) {
      if (character === '"' && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.trim().length === 0) {
      quoted = true;
    } else if (character === ",") {
      rows[rows.length - 1]?.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      rows[rows.length - 1]?.push(field);
      field = "";
      if (character === "\r" && nextCharacter === "\n") index += 1;
      if (index < source.length - 1) rows.push([]);
    } else {
      field += character;
    }
  }

  if (quoted) throw new RecipientSourceError("The recipient CSV contains an unclosed quote.");

  const lastRow = rows[rows.length - 1];
  if (field.length > 0 || (lastRow && lastRow.length > 0)) lastRow?.push(field);
  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
};

const isHeader = (value: string): boolean => headerNames.has(value.trim().toLowerCase());

const sourceValues = (source: string): string[] => {
  if (source.includes("\0"))
    throw new RecipientSourceError("The recipient source contains an invalid null character.");
  if (Buffer.byteLength(source, "utf8") > MAX_RECIPIENT_SOURCE_BYTES) {
    throw new RecipientSourceError("The recipient source is larger than the 1 MB limit.");
  }

  const isCsv = source.includes(",") || source.includes('"');
  if (!isCsv)
    return source
      .split(/\r?\n/)
      .map((value) => value.replace(/^\uFEFF/, "").trim())
      .filter(Boolean);

  const rows = parseCsvRows(source);
  if (rows.length === 0) return [];

  const headerIndex = rows[0]?.findIndex(isHeader) ?? -1;
  if (headerIndex >= 0) return rows.slice(1).map((row) => row[headerIndex] ?? "");
  return rows.flat();
};

export const parseRecipientSource = (source: string): RecipientParseResult => {
  const values = sourceValues(source);
  const accepted: string[] = [];
  const rejected: RejectedRecipient[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || isHeader(normalized)) continue;

    const result = emailSchema.safeParse(normalized);
    if (!result.success) {
      rejected.push({ value: value.trim(), reason: "invalid_email" });
      continue;
    }

    if (seen.has(normalized)) {
      duplicates += 1;
      continue;
    }

    seen.add(normalized);
    accepted.push(normalized);
  }

  return {
    detected: accepted.length + rejected.length + duplicates,
    accepted,
    rejected,
    duplicates,
  };
};
