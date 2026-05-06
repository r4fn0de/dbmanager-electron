import { app } from "electron";
import { z } from "zod";

const latestReleaseSchema = z.object({
  version: z.string().min(1),
  downloadUrl: z.string().url(),
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

  return {
    currentVersion,
    latestVersion: latest.version,
    hasUpdate,
    downloadUrl: latest.downloadUrl,
    notes: latest.notes ?? null,
    publishedAt: latest.publishedAt ?? null,
    metaUrl,
  };
}
