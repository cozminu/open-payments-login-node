import { randomBytes } from "node:crypto";
import type { ParseArgsOptionsConfig } from "node:util";
import type { Clock, IdGenerator, LoginStoreOptions } from "./types.ts";

export const DEFAULT_CLOCK: Clock = () => performance.now();

export const DEFAULT_ID_GENERATOR: IdGenerator = () => randomBytes(24).toString("base64url");

export const DEFAULT_STORE_OPTIONS = {
  now: DEFAULT_CLOCK,
  createId: DEFAULT_ID_GENERATOR,
  pendingLoginTtlMs: 10 * 60_000,
  sessionTtlMs: 60 * 60_000,
} as const satisfies Required<LoginStoreOptions>;

/** `$wallet.example/alice` style payment pointers; the docs and test wallet still show them. */
export const PAYMENT_POINTER_PATTERN = /^\$(?<rest>[^\s/]+(?:\/\S*)?)$/;

export const LOGIN_COOKIE = "op_login";
export const SESSION_COOKIE = "op_session";
export const CALLBACK_PATH = "/callback";
export const MAX_FORM_BYTES = 4_096;

export const DEFAULT_PORT = 3000;

export const CLI_OPTIONS = {
  port: { type: "string" },
  "public-url": { type: "string" },
  "wallet-address": { type: "string" },
  "key-id": { type: "string" },
  "private-key": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;
