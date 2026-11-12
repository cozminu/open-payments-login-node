import assert from "node:assert/strict";
import { test } from "node:test";
import { LoginHash } from "../../src/login/index.ts";

// Example from the Open Payments hash verification docs.
const DOCS_INPUT = {
  clientNonce: "VJLO6A4CATR0KRO",
  interactNonce: "MBDOFXG4Y5CVJCX821LH",
  interactRef: "4IFWWIKYB2PQ6U56NL1",
  authServerUrl: "https://server.example.com/tx",
};

test("computes the docs example hash as unpadded base64url", () => {
  assert.equal(LoginHash.compute(DOCS_INPUT), "x-gguKWTj8rQf7d7i3w3UhzvuJ5bpOlKyAlVpLxBffY");
});

test("accepts the hash as base64url or padded base64", () => {
  assert.deepEqual(
    [
      LoginHash.isValid(DOCS_INPUT, "x-gguKWTj8rQf7d7i3w3UhzvuJ5bpOlKyAlVpLxBffY"),
      LoginHash.isValid(DOCS_INPUT, "x+gguKWTj8rQf7d7i3w3UhzvuJ5bpOlKyAlVpLxBffY="),
    ],
    [true, true],
  );
});

test("rejects a hash computed from a different interaction reference", () => {
  const otherHash = LoginHash.compute({ ...DOCS_INPUT, interactRef: "OTHER" });
  assert.equal(LoginHash.isValid(DOCS_INPUT, otherHash), false);
});

test("rejects an empty hash", () => {
  assert.equal(LoginHash.isValid(DOCS_INPUT, ""), false);
});
