import { app } from "electron";
import { existsSync, rmSync, mkdirSync, readFileSync, renameSync, cpSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { platform, arch } from "node:os";
import { spawnSync } from "node:child_process";
import { LOCAL_DB_DEFAULT_PASSWORD } from "./constants";
import { buildSqliteConnectionString, closeDb as closeSqliteDb, closeAllSqliteDbs } from "./sqlite-driver";
import { closePgResources } from "./kysely-factory";
import { executeBatchDdl, exportSchemaDdl } from "./pg-runtime";
import { hasActiveQueryForConnection } from "./active-queries";
import { decryptSecret, encryptSecret } from "../security/secrets";
import type {
  BranchDeletePreview,
  BranchInfo,
  BranchMeta,
  LocalDbInfo,
  LocalDbEngine,
  MergeBranchSchemaResult,
} from "./types";

/** Runtime require rooted at resources/package.json for packaged app compatibility. */
const runtimeRequire = createRequire(
  join(process.resourcesPath || process.cwd(), "package.json"),
);

type EmbeddedPostgresCtor = new (...args: any[]) => any;
type BetterSqlite3Ctor = new (...args: any[]) => any;

function normalizeEmbeddedPostgresCtor(value: unknown): EmbeddedPostgresCtor {
  if (typeof value === "function") return value as EmbeddedPostgresCtor;
  if (value && typeof value === "object") {
    const asRecord = value as Record<string, unknown>;
    if (typeof asRecord.default === "function") {
      return asRecord.default as EmbeddedPostgresCtor;
    }
  }
  throw new Error("embedded-postgres module did not export a constructor");
}

let embeddedPostgresCached: EmbeddedPostgresCtor | null = null;
let betterSqlite3Cached: BetterSqlite3Ctor | null = null;
let embeddedPostgresRuntimePath: string | null = null;

function loadEmbeddedPostgres(): EmbeddedPostgresCtor {
  if (!embeddedPostgresRuntimePath) {
    ensureEmbeddedPostgresRuntimePackages();
  }

  if (embeddedPostgresRuntimePath) {
    const runtimePkgJson = join(embeddedPostgresRuntimePath, "package.json");
    if (!existsSync(runtimePkgJson)) {
      throw new Error(`Embedded Postgres runtime package.json not found at: ${runtimePkgJson}`);
    }
    const runtimeModuleRequire = createRequire(runtimePkgJson);
    const loadedModule = runtimeModuleRequire("embedded-postgres") as unknown;
    const loaded = normalizeEmbeddedPostgresCtor(loadedModule);
    embeddedPostgresCached = loaded;
    return loaded;
  }
  if (embeddedPostgresCached) return embeddedPostgresCached;

  const base = process.resourcesPath;
  const candidates = [
    "embedded-postgres",
    base ? join(base, "node_modules", "embedded-postgres") : null,
    base ? join(base, "app.asar.unpacked", "node_modules", "embedded-postgres") : null,
    base ? join(base, "embedded-postgres") : null,
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      if (candidate === "embedded-postgres") {
        const loadedModule = runtimeRequire(candidate) as unknown;
        const loaded = normalizeEmbeddedPostgresCtor(loadedModule);
        embeddedPostgresCached = loaded;
        return loaded;
      }

      const pkgJsonPath = join(candidate, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const candidateRequire = createRequire(pkgJsonPath);
      const loadedModule = candidateRequire("embedded-postgres") as unknown;
      const loaded = normalizeEmbeddedPostgresCtor(loadedModule);
      embeddedPostgresCached = loaded;
      return loaded;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to load embedded-postgres. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function loadBetterSqlite3(): BetterSqlite3Ctor {
  if (betterSqlite3Cached) return betterSqlite3Cached;

  const base = process.resourcesPath;
  const candidates = [
    "better-sqlite3",
    base ? join(base, "node_modules", "better-sqlite3") : null,
    base ? join(base, "app.asar.unpacked", "node_modules", "better-sqlite3") : null,
    base ? join(base, "better-sqlite3") : null,
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const loaded = runtimeRequire(candidate) as BetterSqlite3Ctor;
      betterSqlite3Cached = loaded;
      return loaded;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to load better-sqlite3 in local-db-manager. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Metadata stored persistently for each local DB instance */
interface LocalDbMeta {
  id: string;
  name: string;
  database_name: string;
  username: string;
  password: string;
  port: number;
  postgres_version: string;
  auto_start: boolean;
  /** Engine type — determines how the instance is managed. */
  engine: LocalDbEngine;
  /** SQLite-specific: absolute path to the .db file on disk. */
  file_path?: string;
  /** ID of the currently active branch (defaults to the main branch ID). */
  active_branch_id?: string;
}

/** Running instance tracking — PostgreSQL only (SQLite has no process) */
interface RunningInstance {
  pg: any;
  meta: LocalDbMeta;
}

/** SQLite open handle tracking */
interface SqliteHandle {
  db: any;
  meta: LocalDbMeta;
}

const STORAGE_FILE = "local-databases.json";
const BRANCHES_FILE = "branches.json";
const DATA_SUBDIR = "local-dbs";
const SQLITE_SUBDIR = "local-dbs/sqlite";

/** Map (platform, arch) to the @embedded-postgres package name */
function getPlatformPackageName(): string {
  const p = platform();
  const a = arch();
  switch (p) {
    case "darwin":
      return a === "arm64" ? "@embedded-postgres/darwin-arm64" : "@embedded-postgres/darwin-x64";
    case "linux":
      return a === "arm64"
        ? "@embedded-postgres/linux-arm64"
        : a === "arm"
          ? "@embedded-postgres/linux-arm"
          : a === "ia32"
            ? "@embedded-postgres/linux-ia32"
            : a === "ppc64"
              ? "@embedded-postgres/linux-ppc64"
              : "@embedded-postgres/linux-x64";
    case "win32":
      return "@embedded-postgres/windows-x64";
    default:
      return `@embedded-postgres/${p}-${a}`;
  }
}

function getStoragePath(): string {
  return join(app.getPath("userData"), STORAGE_FILE);
}

function getEmbeddedRuntimeRoot(): string {
  return join(app.getPath("userData"), "runtime", "embedded-postgres");
}

function getEmbeddedRuntimeNodeModules(): string {
  return join(getEmbeddedRuntimeRoot(), "node_modules");
}

function getEmbeddedPostgresVersionFromDeps(): string {
  try {
    const appPkgPath = join(app.getAppPath(), "package.json");
    const pkgRaw = readFileSync(appPkgPath, "utf-8");
    const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string> };
    const raw = pkg.dependencies?.["embedded-postgres"] ?? "18.3.0-beta.17";
    return raw.replace(/^[~^]/, "");
  } catch {
    return "18.3.0-beta.17";
  }
}

function downloadFileSync(url: string, destination: string): void {
  const result = spawnSync("curl", ["-L", "-f", "-sS", "-o", destination, url], {
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`Failed to download ${url}: ${result.stderr.toString() || result.stdout.toString()}`);
  }
}

function extractTarGzSync(archivePath: string, outputDir: string): void {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", outputDir], { stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${archivePath}: ${result.stderr.toString() || result.stdout.toString()}`);
  }
}

function installNpmTarballSync(packageName: string, version: string, nodeModulesDir: string): void {
  const escaped = packageName.replace("/", "%2F");
  const fileName = `${packageName.split("/").pop() || packageName}-${version}.tgz`;
  const tarballUrl = `https://registry.npmjs.org/${escaped}/-/${fileName}`;

  const tempDir = join(tmpdir(), `tarsdb-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });

  const archivePath = join(tempDir, fileName);
  downloadFileSync(tarballUrl, archivePath);

  const unpackDir = join(tempDir, "unpack");
  mkdirSync(unpackDir, { recursive: true });
  extractTarGzSync(archivePath, unpackDir);

  const sourceDir = join(unpackDir, "package");
  const targetDir = join(nodeModulesDir, packageName);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  renameSync(sourceDir, targetDir);

  rmSync(tempDir, { recursive: true, force: true });
}

function getBundledPackagePath(packageName: string): string | null {
  const resourcesPath = process.resourcesPath;
  const appPath = app.getAppPath();

  const candidates = [
    resourcesPath ? join(resourcesPath, "node_modules", packageName) : null,
    resourcesPath ? join(resourcesPath, packageName) : null,
    resourcesPath
      ? join(resourcesPath, "app.asar.unpacked", "node_modules", packageName)
      : null,
    join(appPath, "node_modules", packageName),
  ].filter(Boolean) as string[];

  const matched = candidates.find((candidate) => existsSync(join(candidate, "package.json")));
  return matched ?? null;
}

function ensureEmbeddedPostgresRuntimePackages(): void {
  const nodeModulesDir = getEmbeddedRuntimeNodeModules();
  const platformPkg = getPlatformPackageName();

  const packages = [
    "embedded-postgres",
    platformPkg,
    "async-exit-hook",
    "pg",
    "pg-connection-string",
    "pg-pool",
    "pg-protocol",
    "pg-types",
    "pgpass",
    "split2",
    "pg-int8",
    "postgres-array",
    "postgres-bytea",
    "postgres-date",
    "postgres-interval",
    "xtend",
  ];

  mkdirSync(nodeModulesDir, { recursive: true });

  for (const pkg of packages) {
    const targetPkgPath = join(nodeModulesDir, pkg);
    if (existsSync(join(targetPkgPath, "package.json"))) continue;

    const bundledPath = getBundledPackagePath(pkg);
    if (!bundledPath) {
      throw new Error(`Missing bundled runtime package: ${pkg}`);
    }

    mkdirSync(dirname(targetPkgPath), { recursive: true });
    cpSync(bundledPath, targetPkgPath, { recursive: true });
  }

  const embeddedPkgPath = join(nodeModulesDir, "embedded-postgres", "package.json");
  const platformPkgPath = join(nodeModulesDir, platformPkg, "package.json");
  const pgPkgPath = join(nodeModulesDir, "pg", "package.json");

  if (!existsSync(embeddedPkgPath) || !existsSync(platformPkgPath) || !existsSync(pgPkgPath)) {
    throw new Error("Embedded Postgres runtime is incomplete (missing embedded-postgres/platform/pg packages).");
  }

  embeddedPostgresRuntimePath = join(nodeModulesDir, "embedded-postgres");
}

function getBaseDataDir(): string {
  return join(app.getPath("userData"), DATA_SUBDIR);
}

function getInstanceDataDir(id: string): string {
  return join(getBaseDataDir(), id);
}

export class LocalDbManager {
  private runningInstances: Map<string, RunningInstance> = new Map();
  private sqliteHandles: Map<string, SqliteHandle> = new Map();
  private metaCache: LocalDbMeta[] | null = null;
  /** Branch metadata cache, keyed by local DB instance ID. */
  private branchCache: Map<string, BranchMeta[]> = new Map();
  /** Per-local-db operation lock to avoid concurrent branch mutations. */
  private localDbLocks: Map<string, Promise<void>> = new Map();

  // ── Persistence ─────────────────────────────────────────────

  private normalizeMetaList(list: LocalDbMeta[]): LocalDbMeta[] {
    const normalized: LocalDbMeta[] = [];
    const seenIds = new Set<string>();
    const usedPorts = new Set<number>();

    for (const meta of list) {
      if (!meta?.id || seenIds.has(meta.id)) continue;
      if (!Number.isFinite(meta.port)) continue;

      const engine = meta.engine ?? "postgresql";

      if (engine === "sqlite") {
        // Self-heal stale SQLite metadata when the .db file was manually removed
        const filePath = meta.file_path ?? join(getBaseDataDir(), "sqlite", `${meta.id}.db`);
        if (!existsSync(filePath)) continue;
        // SQLite uses port 0 — skip the per-port uniqueness check
      } else {
        // Self-heal stale PostgreSQL metadata when data directory was manually removed
        // or when a previous failed clone left dangling entries.
        const dataDir = getInstanceDataDir(meta.id);
        if (!existsSync(dataDir)) continue;

        // Keep only one configured DB per port to prevent perpetual auto-start
        // conflicts (legacy duplicated metadata can happen after failed flows).
        if (usedPorts.has(meta.port)) continue;
        usedPorts.add(meta.port);
      }

      seenIds.add(meta.id);
      normalized.push(meta);
    }

    return normalized;
  }

  private encryptMetaSecrets(list: LocalDbMeta[]): LocalDbMeta[] {
    return list.map((meta) => ({
      ...meta,
      password: encryptSecret(meta.password),
    }));
  }

  private decryptMetaSecrets(list: LocalDbMeta[]): { list: LocalDbMeta[]; changed: boolean } {
    let changed = false;
    const decrypted = list.map((meta) => {
      const password = decryptSecret(meta.password);
      if (password !== meta.password) changed = true;
      return {
        ...meta,
        password,
      };
    });
    return { list: decrypted, changed };
  }

  private async loadMetaList(): Promise<LocalDbMeta[]> {
    if (this.metaCache) return this.metaCache;
    try {
      const data = await readFile(getStoragePath(), "utf-8");
      const parsed = JSON.parse(data) as LocalDbMeta[];
      const { list: decrypted, changed: decryptedChanged } = this.decryptMetaSecrets(parsed);
      const normalized = this.normalizeMetaList(decrypted);
      this.metaCache = normalized;
      if (decryptedChanged || normalized.length !== parsed.length) {
        await this.saveMetaList(normalized);
      }
    } catch {
      this.metaCache = [];
    }
    return this.metaCache;
  }

  private async saveMetaList(list: LocalDbMeta[]): Promise<void> {
    this.metaCache = list;
    await mkdir(join(getStoragePath(), ".."), { recursive: true });
    const persisted = this.encryptMetaSecrets(list);
    await writeFile(getStoragePath(), JSON.stringify(persisted, null, 2), "utf-8");
  }

  // ── Helpers ─────────────────────────────────────────────────

  // ── Branch persistence ─────────────────────────────────────

  private getBranchesPath(localDbId: string): string {
    return join(getInstanceDataDir(localDbId), BRANCHES_FILE);
  }

  private async loadBranchList(localDbId: string): Promise<BranchMeta[]> {
    const cached = this.branchCache.get(localDbId);
    if (cached) return cached;
    try {
      const data = await readFile(this.getBranchesPath(localDbId), "utf-8");
      const parsed = JSON.parse(data) as BranchMeta[];
      this.branchCache.set(localDbId, parsed);
      return parsed;
    } catch {
      this.branchCache.set(localDbId, []);
      return [];
    }
  }

  private async saveBranchList(localDbId: string, list: BranchMeta[]): Promise<void> {
    this.branchCache.set(localDbId, list);
    const dir = getInstanceDataDir(localDbId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await writeFile(this.getBranchesPath(localDbId), JSON.stringify(list, null, 2), "utf-8");
  }

  /** Sanitize a branch name into a valid PostgreSQL identifier fragment.
   *  Replaces non-alphanumeric chars with underscores, collapses runs,
   *  and prefixes with "br_" to avoid colliding with user DB names. */
  private sanitizeBranchName(name: string): string {
    const sanitized = name
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    return `br_${sanitized}`.slice(0, 63);
  }

  /** Build a PostgreSQL connection string for a branch database. */
  private buildBranchConnectionString(meta: LocalDbMeta, branchDbName: string): string {
    return `postgresql://${encodeURIComponent(meta.username)}:${encodeURIComponent(meta.password)}@localhost:${meta.port}/${branchDbName}`;
  }

  private async withLocalDbLock<T>(localDbId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.localDbLocks.get(localDbId) ?? Promise.resolve();
    let release = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.localDbLocks.set(localDbId, previous.then(() => next));
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.localDbLocks.get(localDbId) === next) {
        this.localDbLocks.delete(localDbId);
      }
    }
  }

  private async listPhysicalDatabases(localDbId: string): Promise<Set<string> | null> {
    const instance = this.runningInstances.get(localDbId);
    if (!instance) return null;
    try {
      const client = instance.pg.getPgClient("postgres");
      await client.connect();
      try {
        const result = await client.query("SELECT datname FROM pg_database");
        const rows = (result as { rows?: Array<{ datname?: string }> } | undefined)?.rows;
        if (!Array.isArray(rows)) return null;
        return new Set(rows.map((row) => row.datname).filter((name): name is string => typeof name === "string"));
      } finally {
        await client.end();
      }
    } catch (err) {
      console.warn(`[local-db] Skipping branch metadata reconciliation for ${localDbId}:`, err);
      return null;
    }
  }

  private async reconcileMissingBranchDatabases(localDbId: string, meta: LocalDbMeta): Promise<BranchMeta[]> {
    const branches = await this.loadBranchList(localDbId);
    const physical = await this.listPhysicalDatabases(localDbId);
    if (!physical) return branches;

    const missing = branches.filter((b) => !b.isMain && !physical.has(b.dbName));
    if (missing.length === 0) return branches;

    const missingIds = new Set(missing.map((b) => b.id));
    const nextBranches = branches.filter((b) => !missingIds.has(b.id));
    await this.saveBranchList(localDbId, nextBranches);
    console.warn(
      `[local-db] Removed ${missing.length} stale branch metadata entries for ${localDbId}: ${missing.map((b) => b.name).join(", ")}`,
    );

    if (meta.active_branch_id && missingIds.has(meta.active_branch_id)) {
      const list = await this.loadMetaList();
      const idx = list.findIndex((m) => m.id === localDbId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], active_branch_id: localDbId };
        await this.saveMetaList(list);
      }
    }

    return nextBranches;
  }

  private collectChildBranchIds(branches: BranchMeta[], branchId: string): string[] {
    const childIds = new Set<string>();
    const collectChildren = (parentId: string) => {
      for (const branch of branches) {
        if (branch.parentId === parentId && !branch.isMain) {
          childIds.add(branch.id);
          collectChildren(branch.id);
        }
      }
    };
    collectChildren(branchId);
    return [...childIds];
  }

  private branchMetaToInfo(
    branch: BranchMeta,
    meta: LocalDbMeta,
    isActive: boolean,
  ): BranchInfo {
    return {
      id: branch.id,
      name: branch.name,
      parentId: branch.parentId,
      isMain: branch.isMain,
      isActive,
      createdAt: branch.createdAt,
      lastMergedAt: branch.lastMergedAt,
      description: branch.description,
      databaseName: branch.dbName,
      connectionString: this.buildBranchConnectionString(meta, branch.dbName),
    };
  }

  private metaToInfo(meta: LocalDbMeta, running: boolean): LocalDbInfo {
    const isSqlite = meta.engine === "sqlite";
    const filePath = meta.file_path ?? (isSqlite ? join(getBaseDataDir(), "sqlite", `${meta.id}.db`) : undefined);
    let databaseName = meta.database_name;
    if (!isSqlite) {
      const branches = this.branchCache.get(meta.id) ?? [];
      const activeBranchId = meta.active_branch_id ?? meta.id;
      const activeBranch = branches.find((b) => b.id === activeBranchId);
      if (activeBranch) databaseName = activeBranch.dbName;
    }

    const connectionString = isSqlite && filePath
      ? buildSqliteConnectionString(filePath)
      : `postgresql://${encodeURIComponent(meta.username)}:${encodeURIComponent(meta.password)}@localhost:${meta.port}/${databaseName}`;

    return {
      id: meta.id,
      name: meta.name,
      database_name: meta.database_name,
      username: meta.username,
      running,
      port: isSqlite ? null : (running ? meta.port : null),
      connection_string: connectionString,
      engine: meta.engine ?? "postgresql",
      postgres_version: meta.engine === "postgresql" ? meta.postgres_version : undefined,
      file_path: filePath,
      externally_connectable: running,
      external_host: isSqlite ? "" : "localhost",
      external_port: isSqlite ? null : (running ? meta.port : null),
      auto_start: meta.auto_start,
    };
  }

  /** Check if a TCP port is available (not in use) */
  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.on("connect", () => {
        socket.end();
        resolve(false); // port is in use
      });
      socket.on("error", () => {
        resolve(true); // port is available
      });
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false); // timeout, assume in use
      });
    });
  }

  /** Find an available port starting from `startPort` */
  async findAvailablePort(startPort: number = 5432, maxAttempts: number = 20): Promise<number> {
    const usedPorts = new Set(
      (await this.loadMetaList()).map((m) => m.port),
    );
    for (let port = startPort; port < startPort + maxAttempts; port++) {
      if (usedPorts.has(port)) continue;
      if (await this.isPortAvailable(port)) return port;
    }
    throw new Error(
      `No available port found in range ${startPort}-${startPort + maxAttempts - 1}`,
    );
  }

  // ── Binary check ───────────────────────────────────────────

  /** Cached result of the binary availability check (won't change at runtime) */
  private binariesAvailable: boolean | null = null;

  /**
   * Best-effort recovery for environments where dependency postinstall scripts
   * were skipped and shared-library symlinks were not created.
   */
  private tryHydrateSymlinks(pkgPath: string): void {
    const hydrateScript = join(pkgPath, "scripts", "hydrate-symlinks.js");
    if (!existsSync(hydrateScript)) return;

    const result = spawnSync("node", [hydrateScript], {
      cwd: pkgPath,
      stdio: "ignore",
    });

    if (result.error) {
      console.warn("[local-db] Could not run hydrate-symlinks script:", result.error.message);
    }
  }

  /**
   * Verify that the embedded-postgres platform binaries are available.
   * If binaries are missing (e.g. because `bun install` was never run
   * and the postinstall scripts didn't execute), throw a clear error with
   * instructions instead of letting embedded-postgres fail with a cryptic message.
   *
   * The result is cached after the first successful check.
   *
   * Note: In packaged Electron apps (asar/pruned), require.resolve may not work.
   * The check falls back to app.getAppPath() / process.resourcesDir in that case.
   */
  private checkBinariesAvailable(): void {
    if (this.binariesAvailable) return;

    const pkgName = getPlatformPackageName();
    const isWindows = platform() === "win32";
    const ext = isWindows ? ".exe" : "";

    // 1. Resolve the platform package path (bundled first)
    let pkgPath: string;
    try {
      pkgPath = dirname(runtimeRequire.resolve(`${pkgName}/package.json`));
    } catch {
      const appPath = app.getAppPath();
      const resourcesPath = process.resourcesPath;
      const fallbackCandidates = [
        join(appPath, "node_modules", pkgName),
        resourcesPath ? join(resourcesPath, "node_modules", pkgName) : null,
        resourcesPath ? join(resourcesPath, pkgName) : null,
        resourcesPath
          ? join(resourcesPath, "app.asar.unpacked", "node_modules", pkgName)
          : null,
      ].filter(Boolean) as string[];

      const matched = fallbackCandidates.find((candidate) =>
        existsSync(join(candidate, "package.json")),
      );

      if (matched) {
        pkgPath = matched;
      } else {
        throw new Error(
          `PostgreSQL binaries for your platform (${pkgName}) are not installed in this build.`,
        );
      }
    }

    // 2. Check that the essential binaries exist (postgres, initdb, pg_ctl)
    //    On Windows, these have a .exe extension.
    const binDir = join(pkgPath, "native", "bin");
    const requiredBinaries = ["postgres", "initdb", "pg_ctl"];
    const missing = requiredBinaries.filter(
      (bin) => !existsSync(join(binDir, `${bin}${ext}`)),
    );

    if (missing.length > 0) {
      throw new Error(
        `PostgreSQL binaries are missing (${missing.join(", ")}). ` +
        `Try removing ${getEmbeddedRuntimeRoot()} and starting again to re-download runtime binaries.`,
      );
    }

    // 3. Check that shared library symlinks were created by the postinstall script
    //    (hydrate-symlinks.js). On macOS/Linux, missing .dylib/.so symlinks will
    //    cause the postgres binary to fail at runtime. (Not applicable on Windows.)
    if (!isWindows) {
      const libDir = join(pkgPath, "native", "lib");
      if (existsSync(libDir)) {
        const symlinksConfig = join(pkgPath, "native", "pg-symlinks.json");
        if (existsSync(symlinksConfig)) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const config = runtimeRequire(symlinksConfig) as Array<{ target: string }>;
            let missingLinks = config.filter(
              // `target` in pg-symlinks.json is relative to package root (e.g. "native/lib/libpq.dylib")
              // so resolve from pkgPath, not libDir.
              (entry) => !existsSync(join(pkgPath, entry.target)),
            );

            if (missingLinks.length > 0) {
              this.tryHydrateSymlinks(pkgPath);
              missingLinks = config.filter(
                (entry) => !existsSync(join(pkgPath, entry.target)),
              );
            }

            if (missingLinks.length > 0) {
              throw new Error(
                `PostgreSQL library symlinks are missing. ` +
                `The postinstall scripts may not have run. ` +
                `Please run: bun install --force`,
              );
            }
          } catch (err) {
            // Re-throw our own friendly errors, ignore JSON parse failures
            if (err instanceof Error && err.message.includes("bun install")) {
              throw err;
            }
          }
        }
      }
    }

    // Cache the successful result — binaries won't change at runtime
    this.binariesAvailable = true;
  }

  // ── CRUD ────────────────────────────────────────────────────

  async create(input: {
    name: string;
    databaseName: string;
    username: string;
    password: string;
    port: number;
    postgresVersion: string;
    autoStart: boolean;
    engine: LocalDbEngine;
  }): Promise<LocalDbInfo> {
    const engine = input.engine ?? "postgresql";

    if (engine === "sqlite") {
      return this.createSqlite(input);
    }
    return this.createPostgres(input);
  }

  private async createPostgres(input: {
    name: string;
    databaseName: string;
    username: string;
    password: string;
    port: number;
    postgresVersion: string;
    autoStart: boolean;
  }): Promise<LocalDbInfo> {
    // Check that embedded-postgres binaries are available before attempting creation
    this.checkBinariesAvailable();

    const port = input.port || 5432;

    // Prevent reserving the same port for multiple local DB definitions.
    const existing = await this.loadMetaList();
    if (existing.some((m) => m.port === port)) {
      throw new Error(
        `Port ${port} is already in use by another configured local database.`,
      );
    }

    // Check port availability before creating.
    // Note: there is a TOCTOU window between this check and when PG actually
    // binds the port, but this is acceptable for a desktop app.
    if (!(await this.isPortAvailable(port))) {
      throw new Error(
        `Port ${port} is already in use. Please choose a different port.`,
      );
    }

    const id = randomUUID();
    const dataDir = getInstanceDataDir(id);

    const meta: LocalDbMeta = {
      id,
      name: input.name,
      database_name: input.databaseName,
      username: input.username || "postgres",
      password: input.password.trim() || LOCAL_DB_DEFAULT_PASSWORD,
      port,
      postgres_version: input.postgresVersion || "16.13.0",
      auto_start: input.autoStart,
      engine: "postgresql",
    };

    // Create and start the embedded postgres instance
    const EmbeddedPostgres = loadEmbeddedPostgres();
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      port: meta.port,
      user: meta.username,
      password: meta.password,
      persistent: true,
      authMethod: "password",
      onLog: (msg: string) => {
        console.log(`[local-db:${id}] ${msg}`);
      },
      onError: (err: string | Error | unknown) => {
        console.error(`[local-db:${id}]`, err);
      },
    });

    try {
      await pg.initialise();
      await pg.start();

      // Create the specified database (if different from default "postgres")
      if (meta.database_name && meta.database_name !== "postgres") {
        const client = pg.getPgClient("postgres");
        await client.connect();
        try {
          await client.query(
            `CREATE DATABASE "${meta.database_name.replace(/"/g, '""')}"`,
          );
        } finally {
          await client.end();
        }
      }
    } catch (err) {
      // Cleanup on failure
      try {
        await pg.stop();
      } catch {
        // ignore
      }
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      throw new Error(
        `Failed to create local database: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Track running instance
    this.runningInstances.set(id, { pg, meta });

    // Persist metadata
    const list = await this.loadMetaList();
    list.push(meta);
    await this.saveMetaList(list);

    // Ensure the main branch exists for new PostgreSQL local DBs.
    // Must run AFTER saveMetaList so ensureMainBranch can find the new DB.
    // Idempotent — no-op if already present.
    try {
      await this.ensureMainBranch(id);
    } catch (err) {
      console.warn(`[local-db] ⚠️ Branch system may not work correctly for DB ${id} — failed to ensure main branch:`, err);
    }

    return this.metaToInfo(meta, true);
  }

  private async createSqlite(input: {
    name: string;
    databaseName: string;
    username: string;
    password: string;
    port: number;
    postgresVersion: string;
    autoStart: boolean;
  }): Promise<LocalDbInfo> {
    const id = randomUUID();

    // Ensure the SQLite data directory exists
    const sqliteDir = join(getBaseDataDir(), "sqlite");
    mkdirSync(sqliteDir, { recursive: true });

    const filePath = join(sqliteDir, `${id}.db`);

    const meta: LocalDbMeta = {
      id,
      name: input.name,
      database_name: input.databaseName || "main",
      username: "", // SQLite has no username
      password: "", // SQLite has no password
      port: 0, // SQLite has no port
      postgres_version: "", // N/A for SQLite
      auto_start: input.autoStart,
      engine: "sqlite",
      file_path: filePath,
    };

    // Create the SQLite database file
    try {
      const BetterSqlite3 = loadBetterSqlite3();
      const db = new BetterSqlite3(filePath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      // Keep handle open for "running" state
      this.sqliteHandles.set(id, { db, meta });
    } catch (err) {
      throw new Error(
        `Failed to create local SQLite database: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Persist metadata
    const list = await this.loadMetaList();
    list.push(meta);
    await this.saveMetaList(list);

    return this.metaToInfo(meta, true);
  }

  async start(id: string): Promise<void> {
    // Already running?
    if (this.runningInstances.has(id) || this.sqliteHandles.has(id)) return;

    const list = await this.loadMetaList();
    const meta = list.find((m) => m.id === id);
    if (!meta) throw new Error(`Local database ${id} not found`);

    const engine = meta.engine ?? "postgresql";

    if (engine === "sqlite") {
      return this.startSqlite(meta);
    }
    return this.startPostgres(meta);
  }

  private async startPostgres(meta: LocalDbMeta): Promise<void> {
    const id = meta.id;

    // Check port availability before starting
    if (!(await this.isPortAvailable(meta.port))) {
      throw new Error(
        `Port ${meta.port} is already in use by another process. Stop that process or change the local database port.`,
      );
    }

    const dataDir = getInstanceDataDir(id);
    if (!existsSync(dataDir)) {
      throw new Error(
        `Local database data directory not found. The database may have been deleted manually.`,
      );
    }

    // Verify the data directory has essential PG files (not a partial init)
    if (!existsSync(join(dataDir, "PG_VERSION"))) {
      throw new Error(
        `Local database data directory is corrupted (missing PG_VERSION). Delete and recreate the local database.`,
      );
    }

    // Check that embedded-postgres binaries are available before attempting start
    this.checkBinariesAvailable();

    const EmbeddedPostgres = loadEmbeddedPostgres();
    const pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      port: meta.port,
      user: meta.username,
      password: meta.password,
      persistent: true,
      authMethod: "password",
      onLog: (msg: string) => {
        console.log(`[local-db:${id}] ${msg}`);
      },
      onError: (err: string | Error | unknown) => {
        console.error(`[local-db:${id}]`, err);
      },
    });

    // Data dir already exists (initialised previously), just start the server
    try {
      await pg.start();
    } catch (err) {
      throw new Error(
        `Failed to start local database: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.runningInstances.set(id, { pg, meta });

    // Ensure the main branch exists (idempotent — no-op if already present).
    // Moved here from individual branch methods so it runs once per start
    // instead of on every branch operation.
    // Wrapped in try/catch so a branch metadata issue doesn't prevent the DB from starting.
    try {
      await this.ensureMainBranch(id);
    } catch (err) {
      console.warn(`[local-db] ⚠️ Branch system may not work correctly for DB ${id} — failed to ensure main branch:`, err);
    }
  }

  private startSqlite(meta: LocalDbMeta): void {
    const id = meta.id;
    const filePath = meta.file_path ?? join(getBaseDataDir(), "sqlite", `${id}.db`);

    if (!existsSync(filePath)) {
      throw new Error(
        `Local SQLite database file not found. The database may have been deleted manually.`,
      );
    }

    try {
      const BetterSqlite3 = loadBetterSqlite3();
      const db = new BetterSqlite3(filePath);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      this.sqliteHandles.set(id, { db, meta });
    } catch (err) {
      throw new Error(
        `Failed to start local SQLite database: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async stop(id: string): Promise<void> {
    // Stop PostgreSQL instance
    const instance = this.runningInstances.get(id);
    if (instance) {
      try {
        await instance.pg.stop();
      } catch (err) {
        console.error(`[local-db:${id}] Error stopping:`, err);
      }
      this.runningInstances.delete(id);
      return;
    }

    // Stop SQLite instance (close local handle + driver cache handle)
    const sqliteHandle = this.sqliteHandles.get(id);
    if (sqliteHandle) {
      try {
        sqliteHandle.db.close();
      } catch (err) {
        console.error(`[local-db:${id}] Error closing SQLite:`, err);
      }
      this.sqliteHandles.delete(id);
      // Also close the driver-level cached handle to avoid WAL/write lock conflicts
      const filePath = sqliteHandle.meta.file_path ?? join(getBaseDataDir(), "sqlite", `${id}.db`);
      closeSqliteDb(buildSqliteConnectionString(filePath));
    }
  }

  async delete(id: string): Promise<void> {
    const meta = (await this.loadMetaList()).find((m) => m.id === id);

    // For PostgreSQL: drop branch databases BEFORE stopping the instance,
    // since stop() removes the running instance from memory.
    if (meta && (meta.engine ?? "postgresql") === "postgresql") {
      const instance = this.runningInstances.get(id);
      if (instance) {
        const branches = await this.loadBranchList(id);
        for (const branch of branches) {
          if (branch.isMain) continue;
          try {
            const client = instance.pg.getPgClient("postgres");
            await client.connect();
            try {
              await client.query(
                `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
                [branch.dbName],
              );
              await client.query(
                `DROP DATABASE IF EXISTS "${branch.dbName.replace(/"/g, '""')}"`,
              );
            } finally {
              await client.end();
            }
          } catch (err) {
            console.warn(`[local-db] Failed to drop branch database "${branch.dbName}" during delete:`, err);
          }
        }
      }
      // Clear branch cache
      this.branchCache.delete(id);
    }

    // Stop if running
    await this.stop(id);

    if (meta) {
      const engine = meta.engine ?? "postgresql";

      if (engine === "sqlite") {
        const filePath = meta.file_path ?? join(getBaseDataDir(), "sqlite", `${id}.db`);
        const connStr = buildSqliteConnectionString(filePath);
        closeSqliteDb(connStr);
        try {
          rmSync(filePath, { force: true });
          try { rmSync(`${filePath}-wal`, { force: true }); } catch { /* ignore */ }
          try { rmSync(`${filePath}-shm`, { force: true }); } catch { /* ignore */ }
        } catch (err) {
          console.error(`[local-db:${id}] Error removing SQLite file:`, err);
        }
      } else {
        // Remove PostgreSQL data directory (includes branches.json)
        const dataDir = getInstanceDataDir(id);
        try {
          rmSync(dataDir, { recursive: true, force: true });
        } catch (err) {
          console.error(`[local-db:${id}] Error removing data dir:`, err);
        }
      }
    }

    // Remove from metadata
    const list = await this.loadMetaList();
    const filtered = list.filter((m) => m.id !== id);
    await this.saveMetaList(filtered);
  }

  async list(): Promise<LocalDbInfo[]> {
    const list = await this.loadMetaList();
    for (const meta of list) {
      if ((meta.engine ?? "postgresql") === "postgresql") {
        await this.loadBranchList(meta.id);
      }
    }
    return list.map((meta) =>
      this.metaToInfo(meta, this.runningInstances.has(meta.id) || this.sqliteHandles.has(meta.id)),
    );
  }

  async getStatus(id: string): Promise<LocalDbInfo | null> {
    const list = await this.loadMetaList();
    const meta = list.find((m) => m.id === id);
    if (!meta) return null;
    if ((meta.engine ?? "postgresql") === "postgresql") {
      await this.loadBranchList(meta.id);
    }
    return this.metaToInfo(meta, this.runningInstances.has(id) || this.sqliteHandles.has(id));
  }

  /** Snapshot of currently running local DB instances (sync, in-memory only). */
  getRunningInstancesSnapshot(): Array<Pick<LocalDbInfo, "id" | "name" | "engine">> {
    const running = new Map<string, Pick<LocalDbInfo, "id" | "name" | "engine">>();

    for (const [id, instance] of this.runningInstances) {
      running.set(id, {
        id,
        name: instance.meta.name,
        engine: instance.meta.engine ?? "postgresql",
      });
    }

    for (const [id, handle] of this.sqliteHandles) {
      running.set(id, {
        id,
        name: handle.meta.name,
        engine: handle.meta.engine ?? "sqlite",
      });
    }

    return [...running.values()];
  }

  // ── Branch CRUD ──────────────────────────────────────────────

  /**
   * Ensure a "main" branch exists for a local DB.
   * Called automatically when a PostgreSQL local DB is created or started.
   */
  private async ensureMainBranch(localDbId: string): Promise<void> {
    const branches = await this.loadBranchList(localDbId);
    if (branches.some((b) => b.isMain)) return;

    const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
    if (!meta) throw new Error(`Local database ${localDbId} not found`);

    const mainBranch: BranchMeta = {
      id: localDbId, // main branch ID = local DB ID (1:1)
      name: "main",
      dbName: meta.database_name, // the original database name
      parentId: localDbId, // self-referential for main
      createdAt: new Date().toISOString(),
      isMain: true,
    };

    branches.push(mainBranch);
    await this.saveBranchList(localDbId, branches);

    // Set the main branch as active if no active branch is set
    if (!meta.active_branch_id) {
      meta.active_branch_id = localDbId;
      const list = await this.loadMetaList();
      const idx = list.findIndex((m) => m.id === localDbId);
      if (idx >= 0) {
        list[idx] = meta;
        await this.saveMetaList(list);
      }
    }
  }

  /**
   * Create a new branch from an existing branch.
   * Uses PostgreSQL CREATE DATABASE ... TEMPLATE to fork the database.
   */
  async createBranch(input: {
    localDbId: string;
    parentBranchId?: string;
    name: string;
    description?: string;
    dataTables?: Array<{ schema: string; table: string }>;
  }): Promise<BranchInfo> {
    return this.withLocalDbLock(input.localDbId, async () => {
      const { localDbId, name, description, dataTables } = input;
      const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
      if (!meta) throw new Error(`Local database ${localDbId} not found`);
      if (meta.engine !== "postgresql") {
        throw new Error("Branching is only supported for PostgreSQL local databases.");
      }
      if (hasActiveQueryForConnection(localDbId)) {
        throw new Error("Cannot create branch while queries are running for this connection.");
      }

      const branches = await this.reconcileMissingBranchDatabases(localDbId, meta);
      const parentBranchId = input.parentBranchId ?? meta.active_branch_id ?? localDbId;
      const parentBranch = branches.find((b) => b.id === parentBranchId);
      if (!parentBranch) {
        throw new Error(`Parent branch ${parentBranchId} not found`);
      }
      if (branches.some((b) => b.name === name)) {
        throw new Error(`Branch "${name}" already exists.`);
      }

      const instance = this.runningInstances.get(localDbId);
      if (!instance) {
        throw new Error("Local database must be running to create a branch.");
      }

      const branchId = randomUUID();
      const dbName = this.sanitizeBranchName(`${name}_${branchId.slice(0, 8)}`);

      try {
        const client = instance.pg.getPgClient("postgres");
        await client.connect();
        try {
          await client.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [parentBranch.dbName],
          );
          await client.query(
            `CREATE DATABASE "${dbName}" TEMPLATE "${parentBranch.dbName.replace(/"/g, '""')}"`,
          );

          if (dataTables !== undefined && dataTables !== null) {
            const dataTablesSet = new Set(dataTables.map((t) => `${t.schema}.${t.table}`));
            const branchClient = instance.pg.getPgClient(dbName);
            await branchClient.connect();
            try {
              const { rows } = await branchClient.query(
                `SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
              );
              for (const row of rows) {
                const key = `${row.schemaname}.${row.tablename}`;
                if (!dataTablesSet.has(key)) {
                  await branchClient.query(
                    `TRUNCATE TABLE "${row.schemaname.replace(/"/g, '""')}"."${row.tablename.replace(/"/g, '""')}" CASCADE`,
                  );
                }
              }
            } finally {
              await branchClient.end();
            }
          }
        } finally {
          await client.end();
        }
      } catch (err) {
        throw new Error(
          `Failed to create branch: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const newBranch: BranchMeta = {
        id: branchId,
        name,
        dbName,
        parentId: parentBranchId,
        createdAt: new Date().toISOString(),
        isMain: false,
        description,
      };

      branches.push(newBranch);
      await this.saveBranchList(localDbId, branches);
      return this.branchMetaToInfo(newBranch, meta, meta.active_branch_id === branchId);
    });
  }

  /**
   * Delete a branch. Cannot delete the main branch or the currently active branch.
   */
  async deleteBranch(localDbId: string, branchId: string): Promise<void> {
    await this.withLocalDbLock(localDbId, async () => {
      const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
      if (!meta) throw new Error(`Local database ${localDbId} not found`);
      if (hasActiveQueryForConnection(localDbId)) {
        throw new Error("Cannot delete branch while queries are running for this connection.");
      }

      const branches = await this.reconcileMissingBranchDatabases(localDbId, meta);
      const branch = branches.find((b) => b.id === branchId);
      if (!branch) throw new Error(`Branch ${branchId} not found`);
      if (branch.isMain) throw new Error("Cannot delete the main branch.");
      if (meta.active_branch_id === branchId) {
        throw new Error("Cannot delete the active branch. Switch to another branch first.");
      }

      const childIds = this.collectChildBranchIds(branches, branchId);
      for (const childId of childIds) {
        if (meta.active_branch_id === childId) {
          const childBranch = branches.find((b) => b.id === childId);
          throw new Error(
            `Cannot delete branch "${branch.name}" because child branch "${childBranch?.name ?? childId}" is active. Switch first.`,
          );
        }
      }

      const instance = this.runningInstances.get(localDbId);
      if (instance) {
        for (const id of [branchId, ...childIds]) {
          const target = branches.find((b) => b.id === id);
          if (!target) continue;
          try {
            const client = instance.pg.getPgClient("postgres");
            await client.connect();
            try {
              await client.query(
                `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
                [target.dbName],
              );
              await client.query(`DROP DATABASE IF EXISTS "${target.dbName.replace(/"/g, '""')}"`);
            } finally {
              await client.end();
            }
            await closePgResources(this.buildBranchConnectionString(meta, target.dbName));
          } catch (err) {
            console.warn(`[local-db] Failed to drop branch database "${target.dbName}":`, err);
          }
        }
      }

      const idsToRemove = new Set([branchId, ...childIds]);
      await this.saveBranchList(localDbId, branches.filter((b) => !idsToRemove.has(b.id)));
    });
  }

  /**
   * Switch the active branch for a local DB.
   * Returns the BranchInfo for the newly active branch.
   */
  async switchBranch(localDbId: string, branchId: string): Promise<BranchInfo> {
    return this.withLocalDbLock(localDbId, async () => {
      const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
      if (!meta) throw new Error(`Local database ${localDbId} not found`);
      const branches = await this.reconcileMissingBranchDatabases(localDbId, meta);
      const branch = branches.find((b) => b.id === branchId);
      if (!branch) throw new Error(`Branch ${branchId} not found`);

      if (meta.active_branch_id === branchId) {
        return this.branchMetaToInfo(branch, meta, true);
      }

      const previous = branches.find((b) => b.id === (meta.active_branch_id ?? localDbId));
      const list = await this.loadMetaList();
      const idx = list.findIndex((m) => m.id === localDbId);
      if (idx < 0) throw new Error(`Local database ${localDbId} not found in metadata.`);
      list[idx] = { ...list[idx], active_branch_id: branchId };
      await this.saveMetaList(list);

      if (previous) {
        await closePgResources(this.buildBranchConnectionString(meta, previous.dbName));
      }
      await closePgResources(this.buildBranchConnectionString(meta, branch.dbName));
      return this.branchMetaToInfo(branch, list[idx], true);
    });
  }

  /**
   * List all branches for a local DB.
   */
  async listBranches(localDbId: string): Promise<BranchInfo[]> {
    const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
    if (!meta) throw new Error(`Local database ${localDbId} not found`);

    const branches = await this.reconcileMissingBranchDatabases(localDbId, meta);
    const activeBranchId = meta.active_branch_id ?? localDbId;

    return branches.map((b) =>
      this.branchMetaToInfo(b, meta, b.id === activeBranchId),
    );
  }

  /**
   * Get info for a single branch.
   */
  async getBranchInfo(localDbId: string, branchId: string): Promise<BranchInfo> {
    const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
    if (!meta) throw new Error(`Local database ${localDbId} not found`);

    const branches = await this.reconcileMissingBranchDatabases(localDbId, meta);
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`Branch ${branchId} not found`);

    const activeBranchId = meta.active_branch_id ?? localDbId;
    return this.branchMetaToInfo(branch, meta, branch.id === activeBranchId);
  }

  /**
   * Rename a branch. Cannot rename the main branch.
   */
  async renameBranch(localDbId: string, branchId: string, newName: string): Promise<BranchInfo> {
    const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
    if (!meta) throw new Error(`Local database ${localDbId} not found`);

    const branches = await this.loadBranchList(localDbId);
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`Branch ${branchId} not found`);
    if (branch.isMain) throw new Error("Cannot rename the main branch.");
    if (branches.some((b) => b.name === newName && b.id !== branchId)) {
      throw new Error(`Branch "${newName}" already exists.`);
    }

    branch.name = newName;
    await this.saveBranchList(localDbId, branches);

    const activeBranchId = meta.active_branch_id ?? localDbId;
    return this.branchMetaToInfo(branch, meta, branch.id === activeBranchId);
  }

  async getActiveBranchConnectionString(localDbId: string): Promise<string> {
    const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
    if (!meta) throw new Error(`Local database ${localDbId} not found`);
    if (meta.engine !== "postgresql") {
      throw new Error("Active branch connection string is only available for PostgreSQL local DBs.");
    }
    const branches = await this.reconcileMissingBranchDatabases(localDbId, meta);
    const activeBranchId = meta.active_branch_id ?? localDbId;
    const activeBranch = branches.find((b) => b.id === activeBranchId);
    if (!activeBranch) throw new Error(`Active branch ${activeBranchId} not found`);
    return this.buildBranchConnectionString(meta, activeBranch.dbName);
  }

  async previewDeleteBranch(localDbId: string, branchId: string): Promise<BranchDeletePreview> {
    const meta = (await this.loadMetaList()).find((m) => m.id === localDbId);
    if (!meta) throw new Error(`Local database ${localDbId} not found`);
    const branches = await this.reconcileMissingBranchDatabases(localDbId, meta);
    const branch = branches.find((b) => b.id === branchId);
    if (!branch) throw new Error(`Branch ${branchId} not found`);
    if (branch.isMain) throw new Error("Cannot delete the main branch.");

    const branchIds = [branchId, ...this.collectChildBranchIds(branches, branchId)];
    const toDelete = branchIds
      .map((id) => branches.find((b) => b.id === id))
      .filter((b): b is BranchMeta => Boolean(b))
      .map((b) => this.branchMetaToInfo(b, meta, b.id === (meta.active_branch_id ?? localDbId)));
    return { branchesToDelete: toDelete, count: toDelete.length };
  }

  async mergeBranchSchema(input: {
    localDbId: string;
    sourceBranchId: string;
    targetBranchId: string;
    dryRun?: boolean;
  }): Promise<MergeBranchSchemaResult> {
    return this.withLocalDbLock(input.localDbId, async () => {
      const meta = (await this.loadMetaList()).find((m) => m.id === input.localDbId);
      if (!meta) throw new Error(`Local database ${input.localDbId} not found`);
      if (meta.engine !== "postgresql") {
        throw new Error("Branch merge is only supported for PostgreSQL local databases.");
      }
      if (hasActiveQueryForConnection(input.localDbId)) {
        throw new Error("Cannot merge branch schema while queries are running for this connection.");
      }

      const branches = await this.reconcileMissingBranchDatabases(input.localDbId, meta);
      const source = branches.find((b) => b.id === input.sourceBranchId);
      const target = branches.find((b) => b.id === input.targetBranchId);
      if (!source) throw new Error(`Source branch ${input.sourceBranchId} not found`);
      if (!target) throw new Error(`Target branch ${input.targetBranchId} not found`);
      if (source.id === target.id) throw new Error("Source and target branches must be different.");

      const sourceConn = this.buildBranchConnectionString(meta, source.dbName);
      const targetConn = this.buildBranchConnectionString(meta, target.dbName);
      const sourceDdl = await exportSchemaDdl(sourceConn);
      const targetDdl = await exportSchemaDdl(targetConn);
      const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim();
      const targetSql = new Set(targetDdl.scripts.map((s) => normalizeSql(s.sql)));
      const statements = sourceDdl.scripts.map((s) => s.sql).filter((sql) => !targetSql.has(normalizeSql(sql)));

      if (input.dryRun) {
        return { statements, applied: 0, errors: [] };
      }

      const result = await executeBatchDdl(targetConn, statements, false);
      const applied = statements.length - result.errors.length;
      if (result.errors.length === 0) {
        target.lastMergedAt = new Date().toISOString();
        await this.saveBranchList(input.localDbId, branches);
      }
      return { statements, applied, errors: result.errors };
    });
  }

  // ── Hydration (reconnect auto-start instances on app launch) ─

  async hydrate(): Promise<void> {
    const list = await this.loadMetaList();
    for (const meta of list) {
      if (!meta.auto_start) continue;

      const engine = meta.engine ?? "postgresql";

      if (engine === "sqlite") {
        const filePath = meta.file_path ?? join(getBaseDataDir(), "sqlite", `${meta.id}.db`);
        if (!existsSync(filePath)) continue;
      } else {
        const dataDir = getInstanceDataDir(meta.id);
        if (!existsSync(dataDir)) continue;
      }

      try {
        await this.start(meta.id);
        console.log(`[local-db] Auto-started: ${meta.name} (${meta.id}) [${engine}]`);
      } catch (err) {
        console.error(
          `[local-db] Failed to auto-start ${meta.name}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  /** Stop all running instances synchronously (call on app quit) */
  stopAllSync(): void {
    // Stop PostgreSQL instances
    for (const [id, instance] of this.runningInstances) {
      try {
        // Access the internal child process to kill it synchronously.
        // This is necessary because Electron's will-quit event is synchronous.
        // Note: reaches into embedded-postgres internals — may break on library updates.
        const pgInternal = instance.pg as unknown as {
          process?: { kill?: (signal?: string) => void };
        };
        if (pgInternal.process && typeof pgInternal.process.kill === "function") {
          pgInternal.process.kill("SIGTERM");
        } else {
          console.warn(
            `[local-db:${id}] Could not access internal process to kill. ` +
            "The embedded-postgres library may have changed internals.",
          );
        }
      } catch (err) {
        console.error(`[local-db:${id}] Error during sync stop:`, err);
      }
      this.runningInstances.delete(id);
    }

    // Close SQLite handles (both manager-level and driver-cached)
    for (const [id, handle] of this.sqliteHandles) {
      try {
        handle.db.close();
      } catch (err) {
        console.error(`[local-db:${id}] Error closing SQLite:`, err);
      }
      this.sqliteHandles.delete(id);
    }
    // Also close all driver-level cached handles to release WAL/write locks
    closeAllSqliteDbs();
  }

  /** Stop all running instances (async, best-effort on quit) */
  async stopAll(): Promise<void> {
    const pgIds = [...this.runningInstances.keys()];
    const sqliteIds = [...this.sqliteHandles.keys()];
    for (const id of [...pgIds, ...sqliteIds]) {
      try {
        await this.stop(id);
      } catch {
        // best effort
      }
    }
  }
}

/** Singleton instance */
export const localDbManager = new LocalDbManager();
