import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const CLI_PATH = new URL("../../src/login/cli.ts", import.meta.url).pathname;

function runCli(args: readonly string[]): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("OP_") && name !== "PORT" && name !== "PUBLIC_URL",
    ),
  );
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("prints usage with --help", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^usage: node src\/login\/cli\.ts/);
});

test("fails when the client wallet address is missing", () => {
  assert.deepEqual(runCli([]), {
    status: 1,
    stdout: "",
    stderr: "login-with-op: missing --wallet-address (or OP_WALLET_ADDRESS)\n",
  });
});

test("fails on an invalid port", () => {
  const result = runCli([
    "--wallet-address",
    "https://wallet.example/app",
    "--key-id",
    "key",
    "--private-key",
    "key.pem",
    "--port",
    "http",
  ]);
  assert.deepEqual(result, {
    status: 1,
    stdout: "",
    stderr: 'login-with-op: port "http" is not a valid port\n',
  });
});
