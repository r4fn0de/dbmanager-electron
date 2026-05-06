import { app } from "electron";
import { z } from "zod";

const latestReleaseSchema = z.object({
  version: z.string().min(1),
  downloadUrl: z.string().url().optional(),
  downloads: z
    .object({
      darwin: z
        .object({
          arm64: z.string().url().optional(),
          x64: z.string().url().optional(),
        })
        .optional(),
      win32: z
        .object({
          x64: z.string().url().optional(),
          arm64: z.string().url().optional(),
        })
        .optional(),
    })
    .optional(),
  notes: z.string().optional().nullable(),
  publishedAt: z.string().optional().nullable(),
});

export type ManualUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  downloadUrl: string;
  notes: string | null;
  publishedAt: string | null;
  metaUrl: string;
  platform: NodeJS.Platform;
  arch: string;
};

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(pa.length, pb.length);

  for (let i = 0; i < max; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  return 0;
}

function resolveMetaUrl(): string {
  const updateMetaUrl = process.env.UPDATE_META_URL?.trim();
  if (updateMetaUrl) {
    return updateMetaUrl;
  }

  const updateBaseUrl = (process.env.UPDATE_BASE_URL?.trim() || "https://update.novon.tech/updates").replace(/\/+$/, "");
  return `${updateBaseUrl}/latest.json`;
}

export async function checkManualUpdate(): Promise<ManualUpdateInfo> {
  const currentVersion = app.getVersion();
  const metaUrl = resolveMetaUrl();

  const response = await fetch(metaUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch latest update metadata (${response.status})`);
  }

  const parsed = latestReleaseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Invalid latest.json format");
  }

  const latest = parsed.data;
  const hasUpdate = compareSemver(latest.version, currentVersion) > 0;

  const platform = process.platform;
  const arch = process.arch;

  const platformDownloads = latest.downloads?.[platform as "darwin" | "win32"];
  const archDownloadUrl = platformDownloads?.[arch as "arm64" | "x64"];
  const hasPlatformMatrix = Boolean(platformDownloads);
  const downloadUrl = hasPlatformMatrix ? archDownloadUrl : latest.downloadUrl;

  if (!downloadUrl) {
    throw new Error(`No download URL for platform=${platform} arch=${arch}.`);
  }

  return {
    currentVersion,
    latestVersion: latest.version,
    hasUpdate,
    downloadUrl,
    notes: latest.notes ?? null,
    publishedAt: latest.publishedAt ?? null,
    metaUrl,
    platform,
    arch,
  };
}
