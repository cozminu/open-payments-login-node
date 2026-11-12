import type { AuthenticatedClient } from "@interledger/open-payments";
import type { LoginProvider } from "./provider.ts";
import type { LoginStore } from "./store.ts";

/** Monotonic milliseconds source; injectable so tests control expiry without sleeping. */
export type Clock = () => number;

/** Returns an unguessable id; used for login ids, session ids and grant nonces. */
export type IdGenerator = () => string;

/** A logged-in browser session, bound to the wallet address the user proved access to. */
export type Session = {
  readonly id: string;
  readonly walletAddress: string;
  readonly expiresAtMs: number;
};

/** Result of starting a login; on `redirect`, send the browser to `redirectUrl`. */
export type LoginStartOutcome =
  | { readonly kind: "redirect"; readonly loginId: string; readonly redirectUrl: string }
  | { readonly kind: "failed"; readonly reason: string };

/** Raw query and cookie values seen on the finish callback, before any validation. */
export type LoginCallback = {
  readonly loginId: string | undefined;
  readonly interactRef: string | undefined;
  readonly hash: string | undefined;
  readonly result: string | undefined;
};

/** Result of finishing a login; `verified` means the wallet's IdP confirmed the user. */
export type LoginFinishOutcome =
  | { readonly kind: "verified"; readonly session: Session }
  | { readonly kind: "failed"; readonly reason: string };

/** Values hashed by the authorization server to sign the finish redirect (GNAP section 4.2.3). */
export type InteractionHashInput = {
  readonly clientNonce: string;
  readonly interactNonce: string;
  readonly interactRef: string;
  readonly authServerUrl: string;
};

/** Options for the in-memory login store. */
export type LoginStoreOptions = {
  readonly now?: Clock;
  readonly createId?: IdGenerator;
  readonly pendingLoginTtlMs?: number;
  readonly sessionTtlMs?: number;
};

/** Dependencies for the login provider. */
export type LoginProviderOptions = {
  /** Client signing requests as this app's own wallet address. */
  readonly client: AuthenticatedClient;
  readonly store: LoginStore;
  readonly createNonce?: IdGenerator;
};

/** Dependencies for the HTTP server. */
export type LoginServerOptions = {
  readonly provider: LoginProvider;
  readonly store: LoginStore;
  /** Public origin of this app; defaults to `http://localhost:<bound port>`. */
  readonly publicUrl?: string;
};

/** A grant waiting for the user to finish interacting with their wallet's authorization server. */
export type PendingLogin = {
  readonly id: string;
  readonly walletAddress: string;
  readonly authServerUrl: string;
  readonly clientNonce: string;
  readonly interactNonce: string;
  readonly continueUrl: string;
  readonly continueAccessToken: string;
  readonly expiresAtMs: number;
};

export type PendingLoginDetails = Omit<PendingLogin, "id" | "expiresAtMs">;

export type HttpReply = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly body: string;
};
