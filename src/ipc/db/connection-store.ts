import { app } from "electron";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { decryptSecret, encryptSecret } from "../security/secrets";
import type { Connection } from "./types";

function encryptConnectionSecrets(connection: Connection): Connection {
  return {
    ...connection,
    password: encryptSecret(connection.password),
    url: connection.url ? encryptSecret(connection.url) : connection.url,
    connection_string: connection.connection_string
      ? encryptSecret(connection.connection_string)
      : connection.connection_string,
  };
}

function decryptConnectionSecrets(connection: Connection): {
  connection: Connection;
  changed: boolean;
} {
  const decryptedPassword = decryptSecret(connection.password);
  const decryptedUrl = connection.url ? decryptSecret(connection.url) : connection.url;
  const decryptedConnectionString = connection.connection_string
    ? decryptSecret(connection.connection_string)
    : connection.connection_string;

  const changed =
    decryptedPassword !== connection.password
    || decryptedUrl !== connection.url
    || decryptedConnectionString !== connection.connection_string;

  return {
    changed,
    connection: {
      ...connection,
      password: decryptedPassword,
      url: decryptedUrl,
      connection_string: decryptedConnectionString,
    },
  };
}

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
    for (let i = 0; i < connections.length; i++) {
      const decrypted = decryptConnectionSecrets(connections[i]);
      if (decrypted.changed) {
        connections[i] = decrypted.connection;
        needsSave = true;
      }

      const conn = connections[i];
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

  const persisted = connections.map(encryptConnectionSecrets);

  await writeFile(path, JSON.stringify(persisted, null, 2), "utf-8");
}
