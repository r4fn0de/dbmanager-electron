import { app } from "electron";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { Connection } from "./types";

const STORAGE_FILE = "connections.json";

function getStoragePath(): string {
  return join(app.getPath("userData"), STORAGE_FILE);
}

export async function loadConnections(): Promise<Connection[]> {
  try {
    const path = getStoragePath();
    const data = await readFile(path, "utf-8");
    const connections = JSON.parse(data) as Connection[];
    // Migration: backfill db_type for connections saved before multi-db support
    let needsSave = false;
    for (const conn of connections) {
      if (!conn.db_type) {
        conn.db_type = "postgresql";
        needsSave = true;
      }
      // Migrate postgres_version → engine_version
      if (!conn.engine_version && conn.postgres_version) {
        conn.engine_version = conn.postgres_version;
        needsSave = true;
      }
    }
    // Persist migration so we don't re-migrate on every launch
    if (needsSave) {
      await saveConnections(connections);
    }
    return connections;
  } catch {
    return [];
  }
}

export async function saveConnections(connections: Connection[]): Promise<void> {
  const path = getStoragePath();
  const dir = join(path, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(connections, null, 2), "utf-8");
}
