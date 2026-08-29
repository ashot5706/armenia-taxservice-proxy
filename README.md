# Armenia Tax Service Proxy

A small Node.js proxy/client for interacting with the Armenian Tax Service (ECRM) endpoints. The proxy handles mutual-TLS (mTLS) client authentication, forwards requests to the ECRM API, and stores receipts locally.

## What this repository contains

- `app.js` — the Express-based proxy server that forwards several Tax Service API calls.
- `package.json` — project metadata and scripts.
- `certs/` — sample place for client certs/keys (not included for security).
- `receipts/` — local receipts saved by the proxy after successful print/return operations.
- `errors/HttpErrors.js` — custom HTTP error helpers used by the app.

## Quick contract

- Inputs: JSON requests matching the Tax Service API bodies (see routes below). Requests must include Authorization header when `AUTH_TOKEN` is set.
- Outputs: JSON responses returned from the Tax Service, or error objects from the proxy.
- Error modes: 400 for bad requests, 401 for invalid token (if configured), 500 for unexpected errors.

## Requirements

- Node.js >= 18 (as expressed in `package.json` engines)
- npm
- A client certificate/key (PEM) or a PKCS#12 (`.p12` / `.pfx`) file for mutual TLS

## Installation

1. Clone or copy this repo.
2. Install dependencies:

```bash
npm install
```

## Configuration

Create a `.env` file in the project root (example variables below). The app uses `dotenv` to load env vars.

Example `.env` values:

```bash
PORT=3000
NODE_ENV=production
TAXSERVICE_BASE_URL=https://ecrm.taxservice.am/taxsystem-rs-vcr

# mTLS options (choose either PEM cert+key or a PKCS12 file)
CLIENT_CERT_PATH=./certs/TIN_CRN.crt  # PEM certificate
CLIENT_KEY_PATH=./certs/TIN.key       # PEM private key
CLIENT_KEY_PASSPHRASE=                # optional
# or
CLIENT_P12_PATH=./certs/TIN_CRN.p12
CLIENT_P12_PASSPHRASE=

# Business identifiers required by Tax Service calls
CRN=your_crn_here
TIN=your_tin_here

# Optional security and integrations
AUTH_TOKEN=some-secret-token         # optional: restrict access to this proxy
PRINT_IDEMPOTENCY_DIR=./idempotency  # durable print request/result markers
TELEGRAM_BOT_TOKEN=123:ABC            # optional: send notifications
TELEGRAM_CHANNEL_ID=@your_channel     # optional: channel id to post receipts

# Timeouts
REQUEST_TIMEOUT_MS=20000
```

Important notes:
- Either set `CLIENT_P12_PATH` (and passphrase) OR set `CLIENT_CERT_PATH` + `CLIENT_KEY_PATH` (and optional `CLIENT_KEY_PASSPHRASE`).
- `CRN` is required by the app and will throw if missing.

## Run

Start the server:

```bash
npm start
```

For development with the `dev` script:

```bash
npm run dev
```

The default port is `3000` (configured with `PORT` env var).

## Exposed routes

The proxy supports the following endpoints (all `POST` unless noted):

- `GET /` — basic info about the proxy
- `POST /checkConnection` — forwards to `/api/v1.0/checkConnection`
- `POST /activate` — forwards to `/api/v1.0/activate`
- `POST /configureDepartments` — forwards to `/api/v1.0/configureDepartments`
- `POST /getGoodList` — forwards to `/api/v1.0/getGoodList` (adds `tin` and default `taxRegime`)
- `POST /print` — forwards to `/api/v1.0/print`; requires an `Idempotency-Key` header
- `POST /printCopy` — forwards to `/api/v1.0/printCopy` (requires `receiptId`)
- `POST /getReturnedReceiptInfo` — forwards to `/api/v1.0/getReturnedReceiptInfo` (requires `receiptId`)
- `POST /printReturnReceipt` — forwards to `/api/v1.0/printReturnReceipt`; requires `receiptId` and an `Idempotency-Key` header
- `GET /healthz` — basic health-check

All routes pass through the mTLS client certificate and will include `crn` and `seq` automatically.

If `AUTH_TOKEN` is set in the `.env`, supply it in requests via the `Authorization: Bearer <token>` header.

### Example cURL

Check connection (without a body):

```bash
curl -v -X POST http://localhost:3000/checkConnection \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "Content-Type: application/json"
```


Replace `http://localhost:3000` with `https://your-host` if you deploy behind TLS.

## Receipts and notifications

- Successful responses that include receipt payloads are stored under `./receipts/` as `receipt_<receiptId>_<timestamp>.json`.
- `/print` and `/printReturnReceipt` store durable request outcomes under `PRINT_IDEMPOTENCY_DIR`. Repeating a completed key replays the original response without printing or returning a receipt again.
- A pending key after any Tax Service error, timeout, or process interruption is treated as an unknown fiscal outcome and returns HTTP 409 instead of risking a duplicate receipt. An operator must reconcile it against the stored receipt/Tax Service before changing that marker.
- `PRINT_IDEMPOTENCY_DIR` must be a persistent filesystem shared by every proxy process serving the same fiscal register. Marker files and directory entries are synced before a print response is acknowledged.
- If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` are set, receipts are posted to the configured Telegram channel.

## Error handling

- Custom HTTP error classes are located in `errors/HttpErrors.js`.
- The app formats `HttpError` instances consistently (status, code, message). Unexpected errors return a 500 with a generic payload.

## Development notes

- The Axios instance automatically injects `crn` and `seq` fields into requests sent to the Tax Service.
- The agent rebuilds connections when `seq` wraps to avoid re-using sequence numbers on a single socket.

## Contributing

Small fixes and documentation improvements are welcome. For larger changes, open an issue first describing the work.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contact

If you need help integrating or want a walkthrough of the code, open an issue or contact the repository owner.
