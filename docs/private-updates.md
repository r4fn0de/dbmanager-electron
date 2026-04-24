# Private Updates (S3 + CloudFront Signed Access)

This project ships private desktop updates for Windows/macOS using `update-electron-app` static storage mode and Squirrel metadata.

## 1) Client runtime configuration

Set these env vars for the packaged app:

- `TARSDB_UPDATE_AUTH_ENDPOINT`: backend endpoint that returns temporary update access
- `TARSDB_UPDATE_CHANNEL`: release channel (`stable`, `staging`, etc.). Default: `stable`
- `TARSDB_UPDATE_CHECK_INTERVAL`: update check cadence. Default: `10 minutes`
- `TARSDB_UPDATE_AUTH_TIMEOUT_MS`: auth request timeout. Default: `8000`
- `TARSDB_UPDATE_AUTH_BEARER` (optional): bearer token for the auth endpoint

The updater integration lives in:

- `src/updater/private-update.ts`
- `src/updater/contracts.ts`

## 2) Auth endpoint contract

`GET /v1/desktop/update-token?platform=<...>&arch=<...>&version=<...>&channel=<...>`

Expected JSON response:

```json
{
  "baseUrl": "https://updates.example.com/updates/stable/win32/x64",
  "expiresAt": "2026-01-01T00:00:00.000Z",
  "cookies": [
    {
      "name": "CloudFront-Policy",
      "value": "<signed-value>",
      "domain": "updates.example.com",
      "path": "/",
      "secure": true,
      "httpOnly": true,
      "sameSite": "no_restriction",
      "expirationDate": 1767225600
    }
  ]
}
```

Reference implementation (example only):

- `scripts/update-auth-server.example.mjs`

## 3) Artifact layout in S3

Layout must follow Squirrel conventions by platform/arch:

- `updates/<channel>/win32/<arch>/RELEASES`
- `updates/<channel>/win32/<arch>/*.nupkg`
- `updates/<channel>/win32/<arch>/* Setup.exe`
- `updates/<channel>/darwin/<arch>/RELEASES.json`
- `updates/<channel>/darwin/<arch>/*.zip`

## 4) CI publish workflow

Workflow:

- `.github/workflows/publish.yaml`

Script used for upload/invalidation:

- `scripts/publish-private-updates.mjs`

Required CI secrets:

- `UPDATE_BUCKET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `UPDATE_BASE_URL` (CloudFront/S3 public origin base for metadata URLs)
- `UPDATE_CLOUDFRONT_DISTRIBUTION_ID` (optional; enables invalidation)

Optional CI vars:

- `UPDATE_PREFIX` (default: `updates`)
- `UPDATE_CHANNEL` (default: `stable`)
- `AWS_REGION` (default: `us-east-1`)

## 5) Provisioning checklist (before production go-live)

- Windows code signing certificate provisioned
- Apple Developer ID certificate provisioned
- macOS notarization credentials configured in CI
- CloudFront key-pair/private key created for signed cookies/URLs
- Bucket public access blocked
- IAM policy scoped to least privilege for CI uploads/invalidation
- Key/certificate rotation runbook documented internally
