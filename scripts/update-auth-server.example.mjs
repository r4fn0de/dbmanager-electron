#!/usr/bin/env node
import { createServer } from "node:http";
import { createSign } from "node:crypto";
import { URL } from "node:url";

const port = Number.parseInt(process.env.PORT || "8788", 10);
const baseOrigin = (process.env.UPDATE_BASE_ORIGIN || "https://updates.example.com").replace(/\/+$/, "");
const defaultChannel = process.env.UPDATE_CHANNEL || "stable";
const cookieDomain = process.env.UPDATE_COOKIE_DOMAIN || new URL(baseOrigin).hostname;
const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID || "";
const privateKeyPem = (process.env.CLOUDFRONT_PRIVATE_KEY_PEM || "").replace(/\\n/g, "\n");
const authToken = process.env.UPDATE_AUTH_TOKEN || "";
const ttlSeconds = Number.parseInt(process.env.UPDATE_TOKEN_TTL_SECONDS || "900", 10);

if (!keyPairId || !privateKeyPem) {
  throw new Error("Set CLOUDFRONT_KEY_PAIR_ID and CLOUDFRONT_PRIVATE_KEY_PEM");
}

function toCfBase64(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/=/g, "_")
    .replace(/\//g, "~");
}

function signPolicy(policy) {
  const signer = createSign("RSA-SHA1");
  signer.update(policy);
  const signature = signer.sign(privateKeyPem);
  return toCfBase64(signature);
}

function buildSignedCookies(resourcePattern, expiresAtEpochSeconds) {
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: resourcePattern,
        Condition: {
          DateLessThan: {
            "AWS:EpochTime": expiresAtEpochSeconds,
          },
        },
      },
    ],
  });

  return [
    { name: "CloudFront-Policy", value: toCfBase64(policy) },
    { name: "CloudFront-Signature", value: signPolicy(policy) },
    { name: "CloudFront-Key-Pair-Id", value: keyPairId },
  ];
}

function sendJson(res, statusCode, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

createServer((req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/v1/desktop/update-token") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (authToken) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${authToken}`) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
    }

    const platform = url.searchParams.get("platform") || "win32";
    const arch = url.searchParams.get("arch") || "x64";
    const channel = url.searchParams.get("channel") || defaultChannel;

    const updateBasePath = `/updates/${channel}/${platform}/${arch}`;
    const baseUrl = `${baseOrigin}${updateBasePath}`;

    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const resourcePattern = `${baseOrigin}${updateBasePath}/*`;
    const signedCookies = buildSignedCookies(resourcePattern, expiresAt);

    sendJson(res, 200, {
      baseUrl,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      cookies: signedCookies.map((cookie) => ({
        ...cookie,
        domain: cookieDomain,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "no_restriction",
        expirationDate: expiresAt,
      })),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}).listen(port, () => {
  console.log(`[update-auth-example] listening on http://localhost:${port}`);
});
