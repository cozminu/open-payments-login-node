import {
  type AuthenticatedClient,
  type WalletAddress,
  isFinalizedGrantWithSubject,
  isPendingGrant,
  OpenPaymentsClientError,
} from "@interledger/open-payments";
import { DEFAULT_ID_GENERATOR, PAYMENT_POINTER_PATTERN } from "./constants.ts";
import { LoginHash } from "./hash.ts";
import type { LoginStore } from "./store.ts";
import type {
  IdGenerator,
  LoginCallback,
  LoginFinishOutcome,
  LoginProviderOptions,
  LoginStartOutcome,
} from "./types.ts";

/** Proves a user controls a wallet address with an interactive Open Payments subject grant. */
export class LoginProvider {
  private readonly client: AuthenticatedClient;
  private readonly store: LoginStore;
  private readonly createNonce: IdGenerator;

  public constructor(options: LoginProviderOptions) {
    this.client = options.client;
    this.store = options.store;
    this.createNonce = options.createNonce ?? DEFAULT_ID_GENERATOR;
  }

  /** Asks the wallet's authorization server to verify the user; `callbackUrl` gets the finish redirect. Never throws. */
  public async start(rawWalletAddress: string, callbackUrl: string): Promise<LoginStartOutcome> {
    const walletAddressUrl = LoginProvider.toWalletAddressUrl(rawWalletAddress);
    if (walletAddressUrl === undefined) {
      return LoginProvider.fail(
        `wallet address ${JSON.stringify(rawWalletAddress)} is not a url or payment pointer`,
      );
    }
    let walletAddress: WalletAddress;
    try {
      walletAddress = await this.client.walletAddress.get({ url: walletAddressUrl });
    } catch (error) {
      return LoginProvider.fail(
        `wallet address ${JSON.stringify(walletAddressUrl)} could not be resolved: ${LoginProvider.describeError(error)}`,
      );
    }
    const clientNonce = this.createNonce();
    let grant: Awaited<ReturnType<AuthenticatedClient["grant"]["request"]>>;
    try {
      grant = await this.client.grant.request(
        { url: walletAddress.authServer },
        {
          subject: { sub_ids: [{ id: walletAddress.id, format: "uri" }] },
          interact: {
            start: ["redirect"],
            finish: { method: "redirect", uri: callbackUrl, nonce: clientNonce },
          },
        },
      );
    } catch (error) {
      return LoginProvider.fail(
        `grant request to ${JSON.stringify(walletAddress.authServer)} failed: ${LoginProvider.describeError(error)}`,
      );
    }
    if (!isPendingGrant(grant)) {
      return LoginProvider.fail(
        `authorization server ${JSON.stringify(walletAddress.authServer)} did not ask for interaction`,
      );
    }
    const pendingLogin = this.store.savePendingLogin({
      walletAddress: walletAddress.id,
      authServerUrl: walletAddress.authServer,
      clientNonce,
      interactNonce: grant.interact.finish,
      continueUrl: grant.continue.uri,
      continueAccessToken: grant.continue.access_token.value,
    });
    return { kind: "redirect", loginId: pendingLogin.id, redirectUrl: grant.interact.redirect };
  }

  /** Checks the finish redirect, continues the grant and opens a session. Never throws. */
  public async finish(callback: LoginCallback): Promise<LoginFinishOutcome> {
    if (callback.loginId === undefined) {
      return LoginProvider.fail("no login in progress for this browser");
    }
    const pendingLogin = this.store.takePendingLogin(callback.loginId);
    if (pendingLogin === undefined) {
      return LoginProvider.fail("login expired or already used");
    }
    if (callback.result !== undefined) {
      return LoginProvider.fail(
        `authorization server ended the interaction: ${JSON.stringify(callback.result)}`,
      );
    }
    if (callback.interactRef === undefined || callback.hash === undefined) {
      return LoginProvider.fail("finish redirect is missing interact_ref or hash");
    }
    const hashInput = {
      clientNonce: pendingLogin.clientNonce,
      interactNonce: pendingLogin.interactNonce,
      interactRef: callback.interactRef,
      authServerUrl: pendingLogin.authServerUrl,
    };
    if (!LoginHash.isValid(hashInput, callback.hash)) {
      return LoginProvider.fail("finish redirect hash does not match");
    }
    let grant: Awaited<ReturnType<AuthenticatedClient["grant"]["continue"]>>;
    try {
      grant = await this.client.grant.continue(
        { url: pendingLogin.continueUrl, accessToken: pendingLogin.continueAccessToken },
        { interact_ref: callback.interactRef },
      );
    } catch (error) {
      return LoginProvider.fail(`grant continuation failed: ${LoginProvider.describeError(error)}`);
    }
    if (!isFinalizedGrantWithSubject(grant)) {
      return LoginProvider.fail("authorization server did not return a subject");
    }
    const isSubjectVerified = grant.subject.sub_ids.some(
      (subjectId) => subjectId.format === "uri" && subjectId.id === pendingLogin.walletAddress,
    );
    if (!isSubjectVerified) {
      return LoginProvider.fail(
        `authorization server did not verify ${JSON.stringify(pendingLogin.walletAddress)}`,
      );
    }
    return { kind: "verified", session: this.store.createSession(pendingLogin.walletAddress) };
  }

  private static toWalletAddressUrl(rawWalletAddress: string): string | undefined {
    const trimmed = rawWalletAddress.trim();
    const paymentPointer = PAYMENT_POINTER_PATTERN.exec(trimmed);
    const candidate =
      paymentPointer?.groups?.rest === undefined
        ? trimmed
        : `https://${paymentPointer.groups.rest}`;
    if (!URL.canParse(candidate)) {
      return undefined;
    }
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  }

  private static describeError(error: unknown): string {
    if (error instanceof OpenPaymentsClientError) {
      const status = error.status === undefined ? "" : ` (status ${error.status})`;
      return `${error.message}${status}: ${error.description}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private static fail(reason: string): { readonly kind: "failed"; readonly reason: string } {
    return { kind: "failed", reason };
  }
}
