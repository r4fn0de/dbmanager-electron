import EmbeddedPostgres from "embedded-postgres";
import { app } from "electron";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { LocalDbInfo } from "./types";

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
}

/** Running instance tracking */
interface RunningInstance {
  pg: EmbeddedPostgres;
  meta: LocalDbMeta;
}

const STORAGE_FILE = "local-databases.json";
const DATA_SUBDIR = "local-dbs";

function getStoragePath(): string {
  return join(app.getPath("userData"), STORAGE_FILE);
}

function getBaseDataDir(): string {
  return join(app.getPath("userData"), DATA_SUBDIR);
}

function getInstanceDataDir(id: string): string {
  return join(getBaseDataDir(), id);
}

export class LocalDbManager {
  private runningInstances: Map<string, RunningInstance> = new Map();
  private metaCache: LocalDbMeta[] | null = null;

  // ── Persistence ─────────────────────────────────────────────

  private async loadMetaList(): Promise<LocalDbMeta[]> {
    if (this.metaCache) return this.metaCache;
    try {
      const data = await readFile(getStoragePath(), "utf-8");
      this.metaCache = JSON.parse(data) as LocalDbMeta[];
    } catch {
      this.metaCache = [];
    }
    return this.metaCache;
  }

  private async saveMetaList(list: LocalDbMeta[]): Promise<void> {
    this.metaCache = list;
    await mkdir(join(getStoragePath(), ".."), { recursive: true });
    await writeFile(getStoragePath(), JSON.stringify(list, null, 2), "utf-8");
  }

  // ── Helpers ─────────────────────────────────────────────────

  private metaToInfo(meta: LocalDbMeta, running: boolean): LocalDbInfo {
    return {
      id: meta.id,
      name: meta.name,
      database_name: meta.database_name,
      username: meta.username,
      running,
      port: running ? meta.port : null,
      connection_string: `postgresql://${encodeURIComponent(meta.username)}:${encodeURIComponent(meta.password)}@localhost:${meta.port}/${meta.database_name}`,
      postgres_version: meta.postgres_version,
      externally_connectable: running,
      external_host: "localhost",
      external_port: running ? meta.port : null,
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

  // ── CRUD ────────────────────────────────────────────────────

  async create(input: {
    name: string;
    databaseName: string;
    username: string;
    password: string;
    port: number;
    postgresVersion: string;
    autoStart: boolean;
  }): Promise<LocalDbInfo> {
    const port = input.port || 5432;

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
      password: input.password || "password",
      port,
      postgres_version: input.postgresVersion || "16.13.0",
      auto_start: input.autoStart,
    };

    // Create and start the embedded postgres instance
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

    return this.metaToInfo(meta, true);
  }

  async start(id: string): Promise<void> {
    // Already running?
    if (this.runningInstances.has(id)) return;

    const list = await this.loadMetaList();
    const meta = list.find((m) => m.id === id);
    if (!meta) throw new Error(`Local database ${id} not found`);

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
  }

  async stop(id: string): Promise<void> {
    const instance = this.runningInstances.get(id);
    if (!instance) return;

    try {
      await instance.pg.stop();
    } catch (err) {
      console.error(`[local-db:${id}] Error stopping:`, err);
    }

    this.runningInstances.delete(id);
  }

  async delete(id: string): Promise<void> {
    // Stop if running
    await this.stop(id);

    // Remove data directory
    const dataDir = getInstanceDataDir(id);
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[local-db:${id}] Error removing data dir:`, err);
    }

    // Remove from metadata
    const list = await this.loadMetaList();
    const filtered = list.filter((m) => m.id !== id);
    await this.saveMetaList(filtered);
  }

  async list(): Promise<LocalDbInfo[]> {
    const list = await this.loadMetaList();
    return list.map((meta) =>
      this.metaToInfo(meta, this.runningInstances.has(meta.id)),
    );
  }

  async getStatus(id: string): Promise<LocalDbInfo | null> {
    const list = await this.loadMetaList();
    const meta = list.find((m) => m.id === id);
    if (!meta) return null;
    return this.metaToInfo(meta, this.runningInstances.has(id));
  }

  // ── Hydration (reconnect auto-start instances on app launch) ─

  async hydrate(): Promise<void> {
    const list = await this.loadMetaList();
    for (const meta of list) {
      if (!meta.auto_start) continue;

      const dataDir = getInstanceDataDir(meta.id);
      if (!existsSync(dataDir)) continue;

      try {
        await this.start(meta.id);
        console.log(`[local-db] Auto-started: ${meta.name} (${meta.id})`);
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
  }

  /** Stop all running instances (async, best-effort on quit) */
  async stopAll(): Promise<void> {
    const ids = [...this.runningInstances.keys()];
    for (const id of ids) {
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
