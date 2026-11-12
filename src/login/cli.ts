import { createAuthenticatedClient } from "@interledger/open-payments";
import { parseArgs } from "node:util";
import { CLI_OPTIONS, DEFAULT_PORT } from "./constants.ts";
import { LoginProvider } from "./provider.ts";
import { LoginServer } from "./server.ts";
import { LoginStore } from "./store.ts";

const USAGE = [
  "usage: node src/login/cli.ts --wallet-address <url> --key-id <id> --private-key <path|pem>",
  "                             [--port <n>] [--public-url <url>]",
  "env: OP_WALLET_ADDRESS, OP_KEY_ID, OP_PRIVATE_KEY, PORT, PUBLIC_URL",
].join("\n");

/** usage: node src/login/cli.ts --wallet-address <url> --key-id <id> --private-key <path|pem> [--port <n>] [--public-url <url>] */
class LoginCli {
  private constructor() {}

  public static async run(args: readonly string[]): Promise<number> {
    try {
      const { values } = parseArgs({ args: [...args], options: CLI_OPTIONS, strict: true });
      if (values.help === true) {
        process.stdout.write(`${USAGE}\n`);
        return 0;
      }
      const walletAddressUrl = LoginCli.requireSetting(
        values["wallet-address"],
        "OP_WALLET_ADDRESS",
        "--wallet-address",
      );
      const keyId = LoginCli.requireSetting(values["key-id"], "OP_KEY_ID", "--key-id");
      const privateKey = LoginCli.requireSetting(
        values["private-key"],
        "OP_PRIVATE_KEY",
        "--private-key",
      );
      const port = LoginCli.parsePort(values.port ?? process.env.PORT ?? String(DEFAULT_PORT));
      const publicUrl = values["public-url"] ?? process.env.PUBLIC_URL;
      const client = await createAuthenticatedClient({ walletAddressUrl, keyId, privateKey });
      const store = new LoginStore();
      const provider = new LoginProvider({ client, store });
      const server = new LoginServer({
        provider,
        store,
        ...(publicUrl === undefined ? {} : { publicUrl }),
      });
      const boundPort = await server.listen(port);
      process.stdout.write(`login-with-op: listening on http://localhost:${boundPort}\n`);
      await LoginCli.waitForShutdown();
      await server.close();
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`login-with-op: ${message}\n`);
      return 1;
    }
  }

  private static requireSetting(
    flagValue: string | undefined,
    envName: string,
    flagName: string,
  ): string {
    const value = flagValue ?? process.env[envName];
    if (value === undefined || value === "") {
      throw new Error(`missing ${flagName} (or ${envName})`);
    }
    return value;
  }

  private static parsePort(rawPort: string): number {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error(`port ${JSON.stringify(rawPort)} is not a valid port`);
    }
    return port;
  }

  private static waitForShutdown(): Promise<void> {
    return new Promise((resolve) => {
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
  }
}

process.exitCode = await LoginCli.run(process.argv.slice(2));
