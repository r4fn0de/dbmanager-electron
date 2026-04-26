import { app, autoUpdater, session, type CookieSameSite } from "electron";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import {
  privateUpdateAuthResponseSchema,
  type CloudFrontCookieDescriptor,
  type PrivateUpdateAuthResponse,
} from "@/updater/contracts";

const DEFAULT_UPDATE_INTERVAL = "10 minutes";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MAX_AUTH_RETRIES = 3;

function logUpdateEvent(event: string, payload?: Record<string, unknown>) {
  const data = payload ? { ...payload } : {};
  console.info(
    JSON.stringify({
      domain: "updater",
      event,
      timestamp: new Date().toISOString(),
      ...data,
    }),
  );
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolveChannel(): string {
  return process.env.TARSDB_UPDATE_CHANNEL?.trim() || "stable";
}

function resolveAuthEndpoint(): string | null {
  const endpoint = process.env.TARSDB_UPDATE_AUTH_ENDPOINT?.trim();
  return endpoint || null;
}

function resolveUpdateInterval(): string {
  return process.env.TARSDB_UPDATE_CHECK_INTERVAL?.trim() || DEFAULT_UPDATE_INTERVAL;
}

function resolveRequestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.TARSDB_UPDATE_AUTH_TIMEOUT_MS || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  return parsed;
}

function buildAuthUrl(endpoint: string): string {
  const url = new URL(endpoint);
  url.searchParams.set("platform", process.platform);
  url.searchParams.set("arch", process.arch);
  url.searchParams.set("version", app.getVersion());
  url.searchParams.set("channel", resolveChannel());
  return url.toString();
}

async function fetchSignedUpdateConfig(endpoint: string): Promise<PrivateUpdateAuthResponse> {
  const timeoutMs = resolveRequestTimeoutMs();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_AUTH_RETRIES; attempt += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const authUrl = buildAuthUrl(endpoint);
      const headers: HeadersInit = {
        Accept: "application/json",
      };
      const bearer = process.env.TARSDB_UPDATE_AUTH_BEARER?.trim();
      if (bearer) {
        headers.Authorization = `Bearer ${bearer}`;
      }

      const response = await fetch(authUrl, {
        method: "GET",
        headers,
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Auth endpoint returned ${response.status}`);
      }

      const json = await response.json();
      return privateUpdateAuthResponseSchema.parse(json);
    } catch (error) {
      lastError = error;
      logUpdateEvent("auth-retry", {
        attempt,
        maxAttempts: MAX_AUTH_RETRIES,
        message: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `Failed to authorize private updates after ${MAX_AUTH_RETRIES} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function toCookieSameSite(value: CloudFrontCookieDescriptor["sameSite"]): CookieSameSite {
  switch (value) {
    case "lax":
      return "lax";
    case "strict":
      return "strict";
    case "unspecified":
      return "unspecified";
    default:
      return "no_restriction";
  }
}

async function applyCloudFrontCookies(baseUrl: string, cookies: CloudFrontCookieDescriptor[]) {
  if (cookies.length === 0) return;

  const origin = new URL(baseUrl).origin;
  for (const cookie of cookies) {
    await session.defaultSession.cookies.set({
      url: origin,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: toCookieSameSite(cookie.sameSite),
      expirationDate: cookie.expirationDate,
    });
  }
}

function createUpdaterLogger() {
  const write = (level: "log" | "info" | "warn" | "error", message: string) => {
    logUpdateEvent("client-log", { level, message });
  };
  return {
    log: (message: string) => write("log", message),
    info: (message: string) => write("info", message),
    warn: (message: string) => write("warn", message),
    error: (message: string) => write("error", message),
  };
}

function bindUpdaterEventsOnce() {
  const marker = "__tarsdbUpdaterEventsBound";
  const globalState = globalThis as typeof globalThis & { [key: string]: boolean | undefined };
  if (globalState[marker]) return;
  globalState[marker] = true;

  autoUpdater.on("checking-for-update", () => logUpdateEvent("checking-for-update"));
  autoUpdater.on("update-available", () => logUpdateEvent("update-available"));
  autoUpdater.on("update-not-available", () => logUpdateEvent("update-not-available"));
  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName, releaseDate, updateURL) => {
    logUpdateEvent("update-downloaded", {
      releaseName,
      releaseDate,
      updateURL,
      releaseNotesPreview: typeof releaseNotes === "string" ? releaseNotes.slice(0, 140) : "",
      installPolicy: "on-next-restart",
    });
  });
  autoUpdater.on("error", (error) => {
    logUpdateEvent("update-error", {
      message: error?.message || String(error),
    });
  });
}

export async function configurePrivateUpdates() {
  const endpoint = resolveAuthEndpoint();
  if (!endpoint) {
    console.warn(
      "[updater] Auto-updates disabled: TARSDB_UPDATE_AUTH_ENDPOINT is not set.",
      "Users will not receive automatic updates.",
    );
    logUpdateEvent("disabled", {
      reason: "missing_auth_endpoint",
      envVar: "TARSDB_UPDATE_AUTH_ENDPOINT",
    });
    return;
  }

  const auth = await fetchSignedUpdateConfig(endpoint);
  const baseUrl = normalizeBaseUrl(auth.baseUrl);
  await applyCloudFrontCookies(baseUrl, auth.cookies);
  bindUpdaterEventsOnce();

  logUpdateEvent("configured", {
    platform: process.platform,
    arch: process.arch,
    channel: resolveChannel(),
    baseUrl,
    expiresAt: auth.expiresAt,
    cookieCount: auth.cookies.length,
  });

  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.StaticStorage,
      baseUrl,
    },
    updateInterval: resolveUpdateInterval(),
    notifyUser: false,
    logger: createUpdaterLogger(),
  });
}
