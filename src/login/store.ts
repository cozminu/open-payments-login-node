import { DEFAULT_STORE_OPTIONS } from "./constants.ts";
import type {
  Clock,
  IdGenerator,
  LoginStoreOptions,
  PendingLogin,
  PendingLoginDetails,
  Session,
} from "./types.ts";

/** In-memory pending logins and sessions with expiry; everything is lost on restart. */
export class LoginStore {
  private readonly now: Clock;
  private readonly createId: IdGenerator;
  private readonly pendingLoginTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly pendingLoginsById = new Map<string, PendingLogin>();
  private readonly sessionsById = new Map<string, Session>();

  public constructor(options: LoginStoreOptions = {}) {
    const pendingLoginTtlMs = options.pendingLoginTtlMs ?? DEFAULT_STORE_OPTIONS.pendingLoginTtlMs;
    const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_STORE_OPTIONS.sessionTtlMs;
    if (!(pendingLoginTtlMs > 0)) {
      throw new RangeError(`pending login ttl must be positive, got ${pendingLoginTtlMs}`);
    }
    if (!(sessionTtlMs > 0)) {
      throw new RangeError(`session ttl must be positive, got ${sessionTtlMs}`);
    }
    this.now = options.now ?? DEFAULT_STORE_OPTIONS.now;
    this.createId = options.createId ?? DEFAULT_STORE_OPTIONS.createId;
    this.pendingLoginTtlMs = pendingLoginTtlMs;
    this.sessionTtlMs = sessionTtlMs;
  }

  /** Stores a pending login under a fresh id. */
  public savePendingLogin(details: PendingLoginDetails): PendingLogin {
    const nowMs = this.now();
    this.prune(nowMs);
    const pendingLogin = {
      ...details,
      id: this.createId(),
      expiresAtMs: nowMs + this.pendingLoginTtlMs,
    };
    this.pendingLoginsById.set(pendingLogin.id, pendingLogin);
    return pendingLogin;
  }

  /** Removes and returns a pending login; single use so a finish redirect can't be replayed. */
  public takePendingLogin(id: string): PendingLogin | undefined {
    this.prune(this.now());
    const pendingLogin = this.pendingLoginsById.get(id);
    this.pendingLoginsById.delete(id);
    return pendingLogin;
  }

  /** Starts a session for a verified wallet address. */
  public createSession(walletAddress: string): Session {
    const nowMs = this.now();
    this.prune(nowMs);
    const session = { id: this.createId(), walletAddress, expiresAtMs: nowMs + this.sessionTtlMs };
    this.sessionsById.set(session.id, session);
    return session;
  }

  /** Returns the session when it exists and hasn't expired. */
  public findSession(id: string): Session | undefined {
    this.prune(this.now());
    return this.sessionsById.get(id);
  }

  public deleteSession(id: string): void {
    this.sessionsById.delete(id);
  }

  private prune(nowMs: number): void {
    for (const [id, pendingLogin] of this.pendingLoginsById) {
      if (pendingLogin.expiresAtMs <= nowMs) {
        this.pendingLoginsById.delete(id);
      }
    }
    for (const [id, session] of this.sessionsById) {
      if (session.expiresAtMs <= nowMs) {
        this.sessionsById.delete(id);
      }
    }
  }
}
