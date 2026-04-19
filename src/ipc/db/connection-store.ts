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
    return JSON.parse(data) as Connection[];
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
