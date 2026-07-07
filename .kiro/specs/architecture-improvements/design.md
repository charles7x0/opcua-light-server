# Design Document: Architecture Improvements

## Overview

Internal refactoring of the OPC UA Light Server Control API to address code duplication, inconsistent error handling patterns, tight coupling in the entry point, and observability gaps. These changes improve maintainability and developer experience without altering external API behavior.

## Architecture

The refactoring touches six areas across the existing module structure:

```
src/
├── utils/
│   └── csv.ts                    ← NEW: shared CSV utilities
├── types/
│   └── result.ts                 ← NEW: shared Result type
├── s7-connector/
│   ├── index.ts                  ← MODIFIED: typed client field
│   └── ipc-bridge.ts             ← NEW: extracted IPC logic
├── db/
│   ├── database.ts               ← MODIFIED: cache invalidation on write
│   └── repositories/
│       └── node-repository.ts    ← MODIFIED: Result pattern
├── config-generator/
│   └── index.ts                  ← MODIFIED: repository injection + logService
├── tofu-manager/
│   └── tofu-manager.ts           ← MODIFIED: logService instead of console
├── api/
│   ├── server.ts                 ← MODIFIED: uses S7IpcBridge + logService
│   └── routes/
│       ├── nodes.ts              ← MODIFIED: shared CSV + Result handling
│       └── s7.ts                 ← MODIFIED: shared CSV
└── log/
    └── index.ts                  ← UNCHANGED (already complete)
```

## Components and Interfaces

### 1. Shared CSV Utilities (`src/utils/csv.ts`)

```typescript
/**
 * Escape a field for CSV output (RFC 4180 compliant).
 */
export function escapeCsvField(value: string): string;

/**
 * Parse a single CSV line respecting quoted fields (RFC 4180).
 */
export function parseCsvLine(line: string): string[];
```

Extracted verbatim from the existing implementations in `routes/nodes.ts` and `routes/s7.ts`. Both route files will import from this shared module.

### 2. Shared Result Type (`src/types/result.ts`)

```typescript
/** Known domain error codes. */
export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

/** Structured domain error. */
export interface DomainError {
  code: DomainErrorCode;
  message: string;
  details?: Array<{ field: string; message: string }>;
}

/** Discriminated union for repository operation results. */
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: DomainError };
```

This aligns with the pattern already used by `S7Repository` and `NamespaceRepository`. The `NodeRepository` will be migrated to return this type.

### 3. NodeRepository Migration

Current pattern (throws with ad-hoc properties):
```typescript
const error = new Error(`Duplicate node name`);
(error as any).isDuplicate = true;
(error as any).validationErrors = [...];
throw error;
```

New pattern (returns Result):
```typescript
return {
  success: false,
  error: {
    code: 'DUPLICATE_ERROR',
    message: `Duplicate node name '${name}' within namespace`,
    details: [{ field: 'name', message: '...' }],
  },
};
```

The route handler changes from try/catch with property inspection to a simple `if (!result.success)` check.

### 4. S7 IPC Bridge (`src/s7-connector/ipc-bridge.ts`)

```typescript
import type { S7ValueUpdate } from './index.js';
import type { ConfigGenerator } from '../config-generator/index.js';
import type { ProcessManager } from '../process-manager/index.js';
import type { Database } from '../db/database.js';
import type { LogService } from '../log/index.js';

export class S7IpcBridge {
  private uuidToOpcUaId: Map<string, string> | null = null;

  constructor(
    private readonly configGenerator: ConfigGenerator,
    private readonly processManager: ProcessManager,
    private readonly database: Database,
    private readonly log: typeof logService
  ) {}

  /**
   * Handle value updates from the S7 Connector.
   * Resolves UUID node IDs to OPC UA node IDs and writes to runtime stdin.
   */
  handleValueUpdates(updates: S7ValueUpdate[]): void;

  /**
   * Invalidate the cached node ID map.
   * Called when address space changes (auto-reload).
   */
  invalidateMap(): void;

  private buildNodeIdMap(): Map<string, string>;
}
```

### 5. Typed nodes7 Client

The `ManagedConnection` interface changes:

```typescript
// Before
client: any;

// After
client: InstanceType<typeof import('nodes7')> | null;
```

Using the type from the existing `src/types/nodes7.d.ts` declaration file.

### 6. Config Generator Repository Injection

```typescript
export class ConfigGenerator {
  constructor(
    private readonly database: Database,
    private readonly namespaceRepo?: NamespaceRepository,
    private readonly nodeRepo?: NodeRepository,
  ) {}
}
```

Optional injection for backward compatibility. When repos are provided, `generate()` uses them for namespace and node retrieval. Direct DB queries remain for complex joins (S7 mapping + connection host).

### 7. Database Cache Invalidation

```typescript
write<T>(writeFn: (db: BetterSqlite3.Database) => T): T {
  if (!this.isAccessible()) {
    throw new DatabaseUnavailableError('...');
  }
  const result = writeFn(this.db!);
  this.clearCache(); // NEW: invalidate all cached reads
  return result;
}
```

## Error Handling

No new error scenarios are introduced. The refactoring preserves all existing error behaviors:

- API responses maintain identical status codes and body formats
- Repository errors are mapped to the same HTTP responses
- The Result pattern makes error handling explicit rather than relying on catch blocks

## Testing Strategy

All existing tests must continue to pass without modification (behavior-preserving refactor). Additional verification:

1. Run `npm test -- --silent` after each change to confirm no regressions
2. CSV utility extraction is verified by existing CSV import/export tests
3. NodeRepository Result pattern is verified by existing node CRUD tests
4. S7 IPC Bridge is verified by existing S7 value-update integration behavior
5. Cache invalidation is verified by existing write-then-read test patterns
