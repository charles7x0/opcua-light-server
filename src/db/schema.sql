-- OPC UA Light Server - SQLite Schema
-- Version 1

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Namespaces
CREATE TABLE IF NOT EXISTS namespaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    uri TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Object nodes (self-referencing for hierarchy, max 5 levels deep)
CREATE TABLE IF NOT EXISTS object_nodes (
    id TEXT PRIMARY KEY,
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    parent_object_node_id TEXT REFERENCES object_nodes(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(namespace_id, parent_object_node_id, name)
);

-- Partial unique index for root-level object nodes (where parent_object_node_id IS NULL)
-- SQLite treats NULLs as distinct in UNIQUE constraints, so we need this index
CREATE UNIQUE INDEX IF NOT EXISTS idx_object_nodes_unique_root
    ON object_nodes(namespace_id, name) WHERE parent_object_node_id IS NULL;

-- Nodes (OPC UA variable nodes)
CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    namespace_id TEXT NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
    object_node_id TEXT REFERENCES object_nodes(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    initial_value TEXT,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(namespace_id, name)
);

-- Security configuration (single row)
CREATE TABLE IF NOT EXISTS security_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL DEFAULT 'None',
    certificate_path TEXT,
    private_key_path TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- S7 PLC connections
CREATE TABLE IF NOT EXISTS s7_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    rack INTEGER NOT NULL DEFAULT 0,
    slot INTEGER NOT NULL DEFAULT 1,
    polling_interval_ms INTEGER NOT NULL DEFAULT 1000,
    reconnect_interval_ms INTEGER NOT NULL DEFAULT 5000,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- S7 variable-to-node mappings
CREATE TABLE IF NOT EXISTS s7_mappings (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES s7_connections(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    plc_address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(connection_id, plc_address),
    UNIQUE(node_id)
);

-- Insert default security config row
INSERT OR IGNORE INTO security_config (id, mode) VALUES (1, 'None');

-- Record schema version
INSERT OR IGNORE INTO schema_migrations (version) VALUES (1);
INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
