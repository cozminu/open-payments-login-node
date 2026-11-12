import assert from "node:assert/strict";
import { test } from "node:test";
import { LoginStore } from "../../src/login/index.ts";

const PENDING_DETAILS = {
  walletAddress: "https://wallet.example/alice",
  authServerUrl: "https://auth.wallet.example/",
  clientNonce: "client-nonce",
  interactNonce: "interact-nonce",
  continueUrl: "https://auth.wallet.example/continue/1",
  continueAccessToken: "continue-token",
};

function createStore(): { readonly store: LoginStore; readonly advance: (ms: number) => void } {
  let nowMs = 1_000;
  let idCount = 0;
  const store = new LoginStore({
    now: () => nowMs,
    createId: () => {
      idCount += 1;
      return `id-${idCount}`;
    },
    pendingLoginTtlMs: 100,
    sessionTtlMs: 500,
  });
  return {
    store,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

test("saves a pending login with a fresh id and expiry", () => {
  const { store } = createStore();
  assert.deepEqual(store.savePendingLogin(PENDING_DETAILS), {
    ...PENDING_DETAILS,
    id: "id-1",
    expiresAtMs: 1_100,
  });
});

test("hands out a pending login only once", () => {
  const { store } = createStore();
  const pendingLogin = store.savePendingLogin(PENDING_DETAILS);
  assert.deepEqual(
    [store.takePendingLogin(pendingLogin.id), store.takePendingLogin(pendingLogin.id)],
    [pendingLogin, undefined],
  );
});

test("drops a pending login once its ttl passes", () => {
  const { store, advance } = createStore();
  const pendingLogin = store.savePendingLogin(PENDING_DETAILS);
  advance(100);
  assert.equal(store.takePendingLogin(pendingLogin.id), undefined);
});

test("finds a session until its ttl passes", () => {
  const { store, advance } = createStore();
  const session = store.createSession("https://wallet.example/alice");
  advance(499);
  const beforeExpiry = store.findSession(session.id);
  advance(1);
  assert.deepEqual([beforeExpiry, store.findSession(session.id)], [session, undefined]);
});

test("forgets a deleted session", () => {
  const { store } = createStore();
  const session = store.createSession("https://wallet.example/alice");
  store.deleteSession(session.id);
  assert.equal(store.findSession(session.id), undefined);
});

test("rejects a non-positive ttl", () => {
  assert.throws(() => new LoginStore({ sessionTtlMs: 0 }), {
    name: "RangeError",
    message: "session ttl must be positive, got 0",
  });
});
