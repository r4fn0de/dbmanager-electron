/**
 * DriverRegistry — maps DatabaseType to DatabaseDriver instances.
 *
 * Handlers resolve the correct driver via `registry.get(dbType)`.
 * New engines are registered at app startup (see `registerDrivers()`).
 */
import type { DatabaseType } from "./types";
import type { DatabaseDriver } from "./driver";

class DriverRegistry {
  private drivers = new Map<DatabaseType, DatabaseDriver>();

  register(driver: DatabaseDriver): void {
    this.drivers.set(driver.type, driver);
  }

  get(type: DatabaseType): DatabaseDriver {
    const driver = this.drivers.get(type);
    if (!driver) {
      throw new Error(`No driver registered for database type: ${type}`);
    }
    return driver;
  }

  has(type: DatabaseType): boolean {
    return this.drivers.has(type);
  }

  /** All registered types. */
  get types(): DatabaseType[] {
    return Array.from(this.drivers.keys());
  }

  /** Resolve DatabaseType from a connection URL/hostname heuristics. */
  detectType(config: { url?: string; host: string }): DatabaseType {
    if (config.url) {
      try {
        const protocol = new URL(config.url).protocol.toLowerCase();
        if (protocol === "mysql:") return "mysql";
        if (protocol === "mariadb:") return "mariadb";
        if (protocol === "postgres:" || protocol === "postgresql:") return "postgresql";
      } catch {
        // fall through
      }
    }
    // Default to postgresql for backward compatibility
    return "postgresql";
  }
}

/** Singleton registry instance. */
export const driverRegistry = new DriverRegistry();

/**
 * Register all built-in drivers. Called once at main-process startup.
 * Each driver module is imported lazily to avoid loading unnecessary code.
 */
export async function registerDrivers(): Promise<void> {
  const { createPostgresDriver } = await import("./pg-driver-adapter");
  driverRegistry.register(createPostgresDriver());

  const { createMysqlDriver, createMariadbDriver } = await import("./mysql-client");
  driverRegistry.register(createMysqlDriver());
  driverRegistry.register(createMariadbDriver());
}
