#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const makeRoot = path.resolve(repoRoot, "out", "make");
const bucket = process.env.UPDATE_BUCKET;
const prefix = (process.env.UPDATE_PREFIX || "updates").replace(/^\/+|\/+$/g, "");
const channel = (process.env.UPDATE_CHANNEL || "stable").trim();
const distributionId = process.env.UPDATE_CLOUDFRONT_DISTRIBUTION_ID?.trim();

if (!bucket) {
  throw new Error("Missing UPDATE_BUCKET env var.");
}

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    files.push(full);
  }
  return files;
}

function parseTarget(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  const basename = path.basename(filePath);

  if (
    basename !== "RELEASES"
    && !basename.endsWith(".nupkg")
    && !basename.endsWith("Setup.exe")
    && basename !== "RELEASES.json"
    && !basename.endsWith(".zip")
  ) {
    return null;
  }

  const squirrelPrefix = "/squirrel.windows/";
  const zipPrefix = "/zip/darwin/";

  if (normalized.includes(squirrelPrefix)) {
    const arch = normalized.split(squirrelPrefix)[1]?.split("/")[0];
    if (!arch) return null;
    return {
      platform: "win32",
      arch,
      basename,
    };
  }

  if (normalized.includes(zipPrefix)) {
    const arch = normalized.split(zipPrefix)[1]?.split("/")[0];
    if (!arch) return null;
    return {
      platform: "darwin",
      arch,
      basename,
    };
  }

  const nameMatch = basename.match(/-(win32|darwin)-([a-z0-9_]+)\b/i);
  if (!nameMatch) return null;
  return {
    platform: nameMatch[1].toLowerCase(),
    arch: nameMatch[2].toLowerCase(),
    basename,
  };
}

function runAws(args) {
  const result = spawnSync("aws", args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`aws ${args.join(" ")} failed with code ${result.status ?? "unknown"}`);
  }
}

const artifactFiles = walk(makeRoot)
  .map((filePath) => ({ filePath, target: parseTarget(filePath) }))
  .filter((item) => item.target !== null);

if (artifactFiles.length === 0) {
  throw new Error(`No update artifacts found under ${makeRoot}`);
}

const uploadedPaths = [];
for (const item of artifactFiles) {
  const { platform, arch, basename } = item.target;
  const key = `${prefix}/${channel}/${platform}/${arch}/${basename}`;
  const destination = `s3://${bucket}/${key}`;
  console.log(`[publish-updates] upload ${item.filePath} -> ${destination}`);
  runAws(["s3", "cp", item.filePath, destination]);
  uploadedPaths.push(`/${key}`);
}

if (distributionId) {
  const uniquePaths = [...new Set(uploadedPaths)];
  console.log(`[publish-updates] invalidate ${uniquePaths.length} CloudFront paths`);
  runAws([
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    distributionId,
    "--paths",
    ...uniquePaths,
  ]);
}

console.log("[publish-updates] done");
