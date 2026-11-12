import { createAuthenticatedClient } from "@interledger/open-payments";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { LoginHash, LoginProvider, LoginServer, LoginStore } from "../../src/login/index.ts";

type Approval = "approve" | "reject" | "tamper";

type FakeOptions = {
  readonly approval?: Approval;
  /** Wallet address path the authorization server claims it verified. */
  readonly verifiedPath?: string;
};

type Fake = {
  readonly url: string;
  readonly grantRequests: unknown[];
  readonly continueRequests: unknown[];
};

type App = { readonly url: string; readonly fake: Fake };

const INTERACT_NONCE = "as-nonce";
const INTERACT_REF = "interact-ref";
const CONTINUE_TOKEN = "continue-token";

async function listen(
  context: TestContext,
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<string> {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** Wallet address server and authorization server in one, playing an IdP that approves on visit. */
async function startFakeOpenPayments(context: TestContext, options: FakeOptions): Promise<Fake> {
  const grantRequests: unknown[] = [];
  const continueRequests: unknown[] = [];
  let finish = { uri: "", nonce: "" };
  const url = await listen(context, async (request, response) => {
    const route = `${request.method} ${request.url}`;
    if (route === "GET /alice") {
      sendJson(response, 200, {
        id: `${url}/alice`,
        publicName: "Alice",
        assetCode: "USD",
        assetScale: 2,
        authServer: `${url}/auth`,
        resourceServer: `${url}/op`,
      });
      return;
    }
    if (route === "POST /auth") {
      const body = await readJson(request);
      grantRequests.push(body);
      const interact = body.interact as { finish: { uri: string; nonce: string } };
      finish = interact.finish;
      sendJson(response, 200, {
        interact: { redirect: `${url}/interact`, finish: INTERACT_NONCE },
        continue: { access_token: { value: CONTINUE_TOKEN }, uri: `${url}/auth/continue/1` },
      });
      return;
    }
    if (route === "GET /interact") {
      const redirect = new URL(finish.uri);
      if (options.approval === "reject") {
        redirect.searchParams.set("result", "grant_rejected");
      } else {
        const hash = LoginHash.compute({
          clientNonce: finish.nonce,
          interactNonce: INTERACT_NONCE,
          interactRef: INTERACT_REF,
          authServerUrl: `${url}/auth`,
        });
        redirect.searchParams.set("interact_ref", INTERACT_REF);
        redirect.searchParams.set("hash", options.approval === "tamper" ? `x${hash}` : hash);
      }
      response.writeHead(302, { location: redirect.href });
      response.end();
      return;
    }
    if (route === "POST /auth/continue/1") {
      continueRequests.push({
        authorization: request.headers.authorization,
        body: await readJson(request),
      });
      sendJson(response, 200, {
        continue: { access_token: { value: "next-token" }, uri: `${url}/auth/continue/1` },
        subject: { sub_ids: [{ id: `${url}${options.verifiedPath ?? "/alice"}`, format: "uri" }] },
      });
      return;
    }
    sendJson(response, 404, { error: "not found" });
  });
  return { url, grantRequests, continueRequests };
}

async function startApp(context: TestContext, options: FakeOptions = {}): Promise<App> {
  const fake = await startFakeOpenPayments(context, options);
  const { privateKey } = generateKeyPairSync("ed25519");
  const client = await createAuthenticatedClient({
    walletAddressUrl: `${fake.url}/app`,
    keyId: "test-key",
    privateKey,
    useHttp: true,
  });
  const store = new LoginStore();
  const server = new LoginServer({ provider: new LoginProvider({ client, store }), store });
  const port = await server.listen(0);
  context.after(() => server.close());
  return { url: `http://localhost:${port}`, fake };
}

function postForm(url: string, fields: Record<string, string>, cookie = ""): Promise<Response> {
  return fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams(fields).toString(),
  });
}

function toCookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
}

/** Submits the login form and follows the IdP redirect; returns the finish callback URL and login cookie. */
async function startLogin(
  app: App,
  walletAddress: string,
): Promise<{ readonly callbackUrl: string; readonly loginCookie: string }> {
  const loginResponse = await postForm(`${app.url}/login`, { walletAddress });
  assert.equal(loginResponse.status, 303);
  const interactResponse = await fetch(loginResponse.headers.get("location") ?? "", {
    redirect: "manual",
  });
  assert.equal(interactResponse.status, 302);
  return {
    callbackUrl: interactResponse.headers.get("location") ?? "",
    loginCookie: toCookieHeader(loginResponse),
  };
}

async function assertLoginFails(response: Response, reason: string): Promise<void> {
  assert.equal(response.status, 400);
  assert.match(await response.text(), new RegExp(reason));
  assert.doesNotMatch(response.headers.getSetCookie().join("\n"), /op_session=[^;]/);
}

test("logs a user in once their wallet's authorization server verifies the subject", async (context) => {
  const app = await startApp(context);
  const { callbackUrl, loginCookie } = await startLogin(app, `${app.fake.url}/alice`);
  const callbackResponse = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: loginCookie },
  });
  assert.equal(callbackResponse.status, 303);
  const home = await fetch(app.url, { headers: { cookie: toCookieHeader(callbackResponse) } });
  assert.match(
    await home.text(),
    new RegExp(`You proved access to <code>${app.fake.url}/alice</code>`),
  );
  assert.deepEqual(app.fake.grantRequests, [
    {
      subject: { sub_ids: [{ id: `${app.fake.url}/alice`, format: "uri" }] },
      interact: {
        start: ["redirect"],
        finish: {
          method: "redirect",
          uri: `${app.url}/callback`,
          nonce: (app.fake.grantRequests[0] as { interact: { finish: { nonce: string } } }).interact
            .finish.nonce,
        },
      },
      client: `${app.fake.url}/app`,
    },
  ]);
  assert.deepEqual(app.fake.continueRequests, [
    { authorization: `GNAP ${CONTINUE_TOKEN}`, body: { interact_ref: INTERACT_REF } },
  ]);
});

test("accepts a payment pointer as the wallet address", async (context) => {
  const app = await startApp(context);
  const { callbackUrl } = await startLogin(app, `$${new URL(app.fake.url).host}/alice`);
  assert.match(callbackUrl, /interact_ref=/);
});

test("logs out by dropping the session", async (context) => {
  const app = await startApp(context);
  const { callbackUrl, loginCookie } = await startLogin(app, `${app.fake.url}/alice`);
  const callbackResponse = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: loginCookie },
  });
  const sessionCookie = toCookieHeader(callbackResponse);
  const logoutResponse = await postForm(`${app.url}/logout`, {}, sessionCookie);
  const home = await fetch(app.url, { headers: { cookie: sessionCookie } });
  assert.equal(logoutResponse.status, 303);
  assert.match(await home.text(), /<form method="post" action="\/login">/);
});

test("rejects a finish redirect whose hash does not match", async (context) => {
  const app = await startApp(context, { approval: "tamper" });
  const { callbackUrl, loginCookie } = await startLogin(app, `${app.fake.url}/alice`);
  const response = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: loginCookie },
  });
  await assertLoginFails(response, "finish redirect hash does not match");
  assert.deepEqual(app.fake.continueRequests, []);
});

test("rejects a login the user denied at their wallet", async (context) => {
  const app = await startApp(context, { approval: "reject" });
  const { callbackUrl, loginCookie } = await startLogin(app, `${app.fake.url}/alice`);
  const response = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: loginCookie },
  });
  await assertLoginFails(response, "authorization server ended the interaction");
});

test("rejects a subject for a different wallet address", async (context) => {
  const app = await startApp(context, { verifiedPath: "/mallory" });
  const { callbackUrl, loginCookie } = await startLogin(app, `${app.fake.url}/alice`);
  const response = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: loginCookie },
  });
  await assertLoginFails(response, "authorization server did not verify");
});

test("rejects a finish redirect in a browser that did not start the login", async (context) => {
  const app = await startApp(context);
  const { callbackUrl } = await startLogin(app, `${app.fake.url}/alice`);
  const response = await fetch(callbackUrl, { redirect: "manual" });
  await assertLoginFails(response, "no login in progress for this browser");
});

test("rejects a replayed finish redirect", async (context) => {
  const app = await startApp(context);
  const { callbackUrl, loginCookie } = await startLogin(app, `${app.fake.url}/alice`);
  await fetch(callbackUrl, { redirect: "manual", headers: { cookie: loginCookie } });
  const response = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { cookie: loginCookie },
  });
  await assertLoginFails(response, "login expired or already used");
});

test("shows an error for a wallet address that does not resolve", async (context) => {
  const app = await startApp(context);
  const response = await postForm(`${app.url}/login`, { walletAddress: `${app.fake.url}/nobody` });
  await assertLoginFails(response, "could not be resolved");
});

test("shows an error for input that is not a wallet address", async (context) => {
  const app = await startApp(context);
  const response = await postForm(`${app.url}/login`, { walletAddress: "alice" });
  await assertLoginFails(response, "is not a url or payment pointer");
});
