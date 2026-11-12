# Login with Open Payments (PoC)

Log a user in by proving they control an Open Payments wallet address. No passwords, no payment.

The user types their wallet address (`https://ilp.interledger-test.dev/alice` or `$ilp.interledger-test.dev/alice`). The app asks that wallet's authorization server for an interactive grant with a `subject` (no `access_token`), sends the user there to approve, checks the `hash` on the way back, continues the grant, and opens a session if the returned `subject.sub_ids` contains the wallet address. This follows the "Verify ownership of a wallet address" guide on openpayments.dev.

## Run

Needs Node 24+ and a wallet address for the app itself, with a developer key (on the test wallet: Settings > Developer Keys).

```sh
npm install
cp .env.example .env   # fill in OP_WALLET_ADDRESS, OP_KEY_ID, OP_PRIVATE_KEY
npm start              # http://localhost:3000
```

Flags override env: `node src/login/cli.ts --help`.

## Layout

- `src/login/provider.ts`: grant request, hash check, continuation, subject check
- `src/login/hash.ts`: GNAP interaction hash
- `src/login/store.ts`: in-memory pending logins and sessions with TTLs
- `src/login/server.ts`: `node:http` app with `/`, `POST /login`, `GET /callback`, `POST /logout`
- `src/login/cli.ts`: config and startup

`npm test` runs the whole flow against a fake wallet address and authorization server on localhost, through the real SDK.

## PoC limits

- State is in memory; a restart logs everyone out.
- No CSRF tokens; relies on `SameSite=Lax` cookies.
- The pending login is bound to the browser by an `op_login` cookie, so a finish redirect can't be replayed or completed in another browser.
- Not yet run against a live authorization server. Subject grants are newer than outgoing-payment grants, so check your wallet provider supports them.
