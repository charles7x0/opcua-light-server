import BetterSqlite3 from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const CURRENT_SCHEMA_VERSION = 3;

/**
 * In-memory cache for read operations when SQLite becomes inaccessible.
 * Stores the last known good state of each table's data.
 */
interface CacheEntry {
  data: unknown[];
  cachedAt: number;
}

/**
 * Database class that manages the SQLite connection, schema initialization,
 * migrations, and provides an in-memory cache fallback for read operations.
 */
export class Database {
  private db: BetterSqlite3.Database | null = null;
  private dbPath: string;
  private cache: Map<string, CacheEntry> = new Map();
  private accessible: boolean = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.initialize();
  }

  /**
   * Initialize the database connection and apply schema if needed.
   */
  private initialize(): void {
    try {
      this.db = new BetterSqlite3(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.applySchema();
      this.accessible = true;
    } catch (error) {
      this.accessible = false;
      throw new Error(
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Apply the schema.sql file on first run or validate the schema version
   * on subsequent runs.
   */
  private applySchema(): void {
    if (!this.db) return;

    // Check if schema_migrations table exists (indicates schema already applied)
    const tableExists = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      )
      .get();

    if (!tableExists) {
      // First run: apply the full schema
      const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
      const schemaSql = readFileSync(schemaPath, 'utf-8');
      this.db.exec(schemaSql);
    } else {
      // Existing database: validate schema version and apply migrations
      this.validateAndMigrate();
    }
  }

  /**
   * Validate the current schema version and apply any pending migrations.
   */
  private validateAndMigrate(): void {
    if (!this.db) return;

    const row = this.db
      .prepare('SELECT MAX(version) as version FROM schema_migrations')
      .get() as { version: number } | undefined;

    const currentVersion = row?.version ?? 0;

    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      this.applyMigrations(currentVersion);
    }
  }

  /**
   * Apply migrations from the given version up to CURRENT_SCHEMA_VERSION.
   * Each migration is a function that receives the database instance.
   */
  private applyMigrations(fromVersion: number): void {
    if (!this.db) return;

    const migrations: Record<number, (db: BetterSqlite3.Database) => void> = {
      // Migration 2: Rename folders to object_nodes, folder_id to object_node_id
      2: (db) => {
        db.exec(`
          ALTER TABLE folders RENAME TO object_nodes;
        `);
        db.exec(`
          ALTER TABLE object_nodes RENAME COLUMN parent_folder_id TO parent_object_node_id;
        `);
        // Recreate the partial unique index with the new table/column names
        db.exec(`
          DROP INDEX IF EXISTS idx_folders_unique_root;
        `);
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_object_nodes_unique_root
            ON object_nodes(namespace_id, name) WHERE parent_object_node_id IS NULL;
        `);
        // Rename folder_id column in nodes table
        db.exec(`
          ALTER TABLE nodes RENAME COLUMN folder_id TO object_node_id;
        `);
      },
      // Migration 3: Add description column to s7_mappings
      3: (db) => {
        db.exec(`ALTER TABLE s7_mappings ADD COLUMN description TEXT;`);
      },
    };

    const transaction = this.db.transaction(() => {
      for (let v = fromVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
        const migration = migrations[v];
        if (migration) {
          migration(this.db!);
        }
        this.db!.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(v);
      }
    });

    transaction();
  }

  /**
   * Check if the database is currently accessible.
   */
  isAccessible(): boolean {
    if (!this.db) {
      this.accessible = false;
      return false;
    }

    try {
      this.db.prepare('SELECT 1').get();
      this.accessible = true;
      return true;
    } catch {
      this.accessible = false;
      return false;
    }
  }

  /**
   * Get the underlying better-sqlite3 database instance.
   * Throws if the database is not accessible.
   */
  getConnection(): BetterSqlite3.Database {
    if (!this.db || !this.accessible) {
      throw new DatabaseUnavailableError('Database is not accessible');
    }
    return this.db;
  }

  /**
   * Get the current schema version.
   */
  getSchemaVersion(): number {
    if (!this.db) return 0;

    try {
      const row = this.db
        .prepare('SELECT MAX(version) as version FROM schema_migrations')
        .get() as { version: number } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Update the in-memory cache for a given key.
   */
  updateCache(key: string, data: unknown[]): void {
    this.cache.set(key, {
      data,
      cachedAt: Date.now(),
    });
  }

  /**
   * Retrieve cached data for a given key.
   * Returns null if no cache entry exists.
   */
  getFromCache(key: string): unknown[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return entry.data;
  }

  /**
   * Clear all cached data.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Execute a read operation with cache fallback.
   * If the database is accessible, executes the query and updates the cache.
   * If inaccessible, returns cached data if available.
   */
  readWithCache<T>(cacheKey: string, queryFn: (db: BetterSqlite3.Database) => T[]): T[] {
    if (this.isAccessible()) {
      try {
        const result = queryFn(this.db!);
        this.updateCache(cacheKey, result as unknown[]);
        return result;
      } catch {
        // Fall through to cache
      }
    }

    const cached = this.getFromCache(cacheKey);
    if (cached !== null) {
      return cached as T[];
    }

    throw new DatabaseUnavailableError(
      'Database is not accessible and no cached data is available'
    );
  }

  /**
   * Execute a write operation. Throws if the database is not accessible.
   * Clears all cached reads after a successful write to ensure subsequent
   * reads return fresh data.
   */
  write<T>(writeFn: (db: BetterSqlite3.Database) => T): T {
    if (!this.isAccessible()) {
      throw new DatabaseUnavailableError(
        'Database is not accessible. Write operations are unavailable.'
      );
    }
    const result = writeFn(this.db!);
    this.clearCache();
    return result;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.accessible = false;
    }
  }
}

/**
 * Error thrown when the database is unavailable.
 */
export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}
