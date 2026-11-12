import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CALLBACK_PATH, LOGIN_COOKIE, MAX_FORM_BYTES, SESSION_COOKIE } from "./constants.ts";
import type { LoginProvider } from "./provider.ts";
import type { LoginStore } from "./store.ts";
import type { HttpReply, LoginServerOptions, Session } from "./types.ts";

/** Minimal web app: a login form, the grant finish callback, and a page showing who's logged in. */
export class LoginServer {
  private readonly provider: LoginProvider;
  private readonly store: LoginStore;
  private readonly publicUrl: string | undefined;
  private readonly server: Server;

  public constructor(options: LoginServerOptions) {
    if (options.publicUrl !== undefined && !URL.canParse(options.publicUrl)) {
      throw new RangeError(`public url ${JSON.stringify(options.publicUrl)} is not a url`);
    }
    this.provider = options.provider;
    this.store = options.store;
    this.publicUrl = options.publicUrl;
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  /** Starts listening and resolves with the bound port. */
  public listen(port: number, host = "localhost"): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.off("error", reject);
        resolve((this.server.address() as AddressInfo).port);
      });
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error === undefined ? resolve() : reject(error)));
      this.server.closeAllConnections();
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let reply: HttpReply;
    try {
      reply = await this.route(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply = LoginServer.page(500, "Something broke", `<p>${LoginServer.escapeHtml(message)}</p>`);
    }
    response.writeHead(reply.status, reply.headers);
    response.end(reply.body);
  }

  private async route(request: IncomingMessage): Promise<HttpReply> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const cookies = LoginServer.parseCookies(request.headers.cookie);
    const route = `${request.method ?? "GET"} ${url.pathname}`;
    switch (route) {
      case "GET /":
        return this.showHome(cookies);
      case "POST /login":
        return this.startLogin(await LoginServer.readForm(request));
      case `GET ${CALLBACK_PATH}`:
        return this.finishLogin(url.searchParams, cookies);
      case "POST /logout":
        return this.logout(cookies);
      default:
        return LoginServer.page(404, "Not found", '<p><a href="/">Home</a></p>');
    }
  }

  private showHome(cookies: ReadonlyMap<string, string>): HttpReply {
    const sessionId = cookies.get(SESSION_COOKIE);
    const session = sessionId === undefined ? undefined : this.store.findSession(sessionId);
    if (session === undefined) {
      return LoginServer.page(200, "Log in with Open Payments", LoginServer.renderLoginForm(""));
    }
    return LoginServer.page(200, "Logged in", LoginServer.renderSession(session));
  }

  private async startLogin(form: URLSearchParams): Promise<HttpReply> {
    const rawWalletAddress = form.get("walletAddress") ?? "";
    const outcome = await this.provider.start(rawWalletAddress, this.resolveCallbackUrl());
    switch (outcome.kind) {
      case "redirect":
        return {
          status: 303,
          headers: {
            location: outcome.redirectUrl,
            "set-cookie": LoginServer.formatCookie(LOGIN_COOKIE, outcome.loginId, CALLBACK_PATH),
          },
          body: "",
        };
      case "failed":
        return LoginServer.page(
          400,
          "Log in with Open Payments",
          `<p class="error">${LoginServer.escapeHtml(outcome.reason)}</p>${LoginServer.renderLoginForm(rawWalletAddress)}`,
        );
    }
  }

  private async finishLogin(
    query: URLSearchParams,
    cookies: ReadonlyMap<string, string>,
  ): Promise<HttpReply> {
    const outcome = await this.provider.finish({
      loginId: cookies.get(LOGIN_COOKIE),
      interactRef: query.get("interact_ref") ?? undefined,
      hash: query.get("hash") ?? undefined,
      result: query.get("result") ?? undefined,
    });
    const clearLoginCookie = LoginServer.formatClearedCookie(LOGIN_COOKIE, CALLBACK_PATH);
    switch (outcome.kind) {
      case "verified":
        return {
          status: 303,
          headers: {
            location: "/",
            "set-cookie": [
              clearLoginCookie,
              LoginServer.formatCookie(SESSION_COOKIE, outcome.session.id, "/"),
            ],
          },
          body: "",
        };
      case "failed":
        return {
          ...LoginServer.page(
            400,
            "Login failed",
            `<p class="error">${LoginServer.escapeHtml(outcome.reason)}</p><p><a href="/">Try again</a></p>`,
          ),
          headers: { "content-type": "text/html; charset=utf-8", "set-cookie": clearLoginCookie },
        };
    }
  }

  private logout(cookies: ReadonlyMap<string, string>): HttpReply {
    const sessionId = cookies.get(SESSION_COOKIE);
    if (sessionId !== undefined) {
      this.store.deleteSession(sessionId);
    }
    return {
      status: 303,
      headers: {
        location: "/",
        "set-cookie": LoginServer.formatClearedCookie(SESSION_COOKIE, "/"),
      },
      body: "",
    };
  }

  private resolveCallbackUrl(): string {
    const origin =
      this.publicUrl ?? `http://localhost:${(this.server.address() as AddressInfo).port}`;
    return new URL(CALLBACK_PATH, origin).href;
  }

  private static renderLoginForm(walletAddress: string): string {
    return [
      '<form method="post" action="/login">',
      '<label for="walletAddress">Wallet address</label>',
      `<input id="walletAddress" name="walletAddress" required placeholder="https://ilp.interledger-test.dev/alice" value="${LoginServer.escapeHtml(walletAddress)}">`,
      '<button type="submit">Log in</button>',
      "</form>",
    ].join("\n");
  }

  private static renderSession(session: Session): string {
    return [
      `<p>You proved access to <code>${LoginServer.escapeHtml(session.walletAddress)}</code>.</p>`,
      '<form method="post" action="/logout"><button type="submit">Log out</button></form>',
    ].join("\n");
  }

  private static page(status: number, title: string, body: string): HttpReply {
    const html = [
      "<!doctype html>",
      '<html lang="en">',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${LoginServer.escapeHtml(title)}</title>`,
      "<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem}input{width:100%;padding:.5rem;margin:.5rem 0;box-sizing:border-box}button{padding:.5rem 1rem}.error{color:#b00020}</style>",
      `<h1>${LoginServer.escapeHtml(title)}</h1>`,
      body,
      "</html>",
    ];
    return {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: `${html.join("\n")}\n`,
    };
  }

  // Lax so the cookie survives the top-level redirect back from the wallet's authorization server.
  private static formatCookie(name: string, value: string, path: string): string {
    return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax`;
  }

  private static formatClearedCookie(name: string, path: string): string {
    return `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  private static parseCookies(header: string | undefined): ReadonlyMap<string, string> {
    const entries = (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.includes("="))
      .map((part): [string, string] => {
        const separatorIndex = part.indexOf("=");
        return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)];
      });
    return new Map(entries);
  }

  private static async readForm(request: IncomingMessage): Promise<URLSearchParams> {
    const chunks: Buffer[] = [];
    let byteCount = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      byteCount += buffer.length;
      if (byteCount > MAX_FORM_BYTES) {
        throw new RangeError(`form body exceeds ${MAX_FORM_BYTES} bytes`);
      }
      chunks.push(buffer);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  }

  private static escapeHtml(text: string): string {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
