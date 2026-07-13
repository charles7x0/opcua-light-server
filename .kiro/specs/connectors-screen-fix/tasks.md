# Implementation Plan

## Overview

Fix the unified Connectors screen (`ConnectorsManager.tsx`) by replacing placeholder elements with fully-implemented subcomponents (`ProtocolSelector`, `ConnectionForm`, `ConnectionCard`, `MappingTable`, `CsvImportExport`) and wiring proper state management, TanStack Query mutations, and data fetching.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Placeholder UI Instead of Functional Subcomponents
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists in ConnectorsManager
  - **Scoped PBT Approach**: Scope the property to the concrete failing cases — render ConnectorsManager with mock connections and attempt CRUD interactions
  - Create file `tests/components/connectors-bug-condition.test.tsx`
  - Mock `getConnections` to return a list of connections and `getConnectorStatus` to return statuses
  - Test 1: Render ConnectorsManager, click "+ New Connection", assert that `ProtocolSelector` renders (look for `aria-label="Select Siemens S7 protocol"`) — will FAIL (finds placeholder `<p>` text instead)
  - Test 2: With mock connections, assert that `ConnectionCard` component renders with Edit/Delete buttons (`aria-label` containing "Edit connection" and "Delete connection") — will FAIL (inline `<div>` cards without buttons)
  - Test 3: Assert that `CsvImportExport` component renders (look for "Export Mappings CSV" button text) — will FAIL (component not mounted)
  - Test 4: Property-based test using fast-check: generate random protocol types from `['s7', 'modbus-tcp', 'ethernet-ip']` and random connection lists, assert that all connections render via `ConnectionCard` with protocol badges — will FAIL (inline divs rendered instead)
  - Run test on UNFIXED code: `npx vitest run tests/components/connectors-bug-condition.test.tsx --project components --silent`
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: ConnectorsManager renders placeholder text and inline divs instead of ProtocolSelector, ConnectionCard, and CsvImportExport
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Filter Tabs, Loading State, Empty State, and Status Polling
  - **IMPORTANT**: Follow observation-first methodology
  - Create file `tests/components/connectors-preservation.test.tsx`
  - Mock `getConnections` and `getConnectorStatus` from the API module
  - Observe: Render ConnectorsManager with pending query → "Loading connections..." with `aria-live="polite"` renders on unfixed code
  - Observe: Render ConnectorsManager with empty connections array → "No connections configured" text renders on unfixed code
  - Observe: Render ConnectorsManager with connections and click filter tabs → connections are filtered by protocol type on unfixed code
  - Observe: `getConnectorStatus` is called with `refetchInterval: 5000` for real-time status badges on unfixed code
  - Write property-based test using fast-check: generate random subsets of protocol filters from `['', 's7', 'modbus-tcp', 'ethernet-ip']`, assert that switching tabs calls `getConnections` with correct type filter parameter
  - Write property-based test: generate random connection lists with random protocol types, assert that all protocol filter tabs render with correct labels ("All", "S7", "Modbus TCP", "EtherNet/IP") regardless of data
  - Write example tests: verify loading state renders "Loading connections..." when query is pending, empty state renders "No connections configured" when array is empty
  - Verify all tests pass on UNFIXED code: `npx vitest run tests/components/connectors-preservation.test.tsx --project components --silent`
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix ConnectorsManager — Wire subcomponents with state management and mutations

  - [x] 3.1 Add state management and TanStack Query mutations to ConnectorsManager
    - Add `selectedProtocol: string | null` state for tracking protocol selection from ProtocolSelector
    - Add `editingConnection: ConnectorConnection | null` state for edit mode
    - Add `useQuery` for `getMappings()` with query key `['connectors-mappings']`
    - Add `useQuery` for `getConnectorValues()` with `refetchInterval: 2000` and query key `['connectors-values']`
    - Add `useQuery` for `getNodes()` (from existing nodes API) with query key `['nodes']`
    - Import `useQueryClient` for cache invalidation
    - Add `useMutation` for `createConnection` → on success invalidate `['connectors-connections']` and reset form state
    - Add `useMutation` for `updateConnection` → on success invalidate `['connectors-connections']` and reset form state
    - Add `useMutation` for `deleteConnection` → on success invalidate `['connectors-connections']` and `['connectors-mappings']`
    - Add `useMutation` for `createMapping` → on success invalidate `['connectors-mappings']`
    - Add `useMutation` for `deleteMapping` → on success invalidate `['connectors-mappings']`
    - Add `resetForm()` helper that clears `showProtocolSelector`, `selectedProtocol`, and `editingConnection`
    - _Bug_Condition: isBugCondition(input) where no mutations are wired and no form state exists_
    - _Expected_Behavior: mutations call correct API functions and invalidate relevant query keys_
    - _Preservation: Filter tabs, loading state, empty state, status polling must remain unchanged_
    - _Requirements: 2.1, 2.2, 2.5, 2.6_

  - [x] 3.2 Replace protocol selector placeholder with ProtocolSelector and ConnectionForm
    - When `showProtocolSelector` is true and `selectedProtocol` is null and `editingConnection` is null: render `<ProtocolSelector onSelect={setSelectedProtocol} onCancel={resetForm} />`
    - When `selectedProtocol` is set (or `editingConnection` is set): render `<ConnectionForm type={selectedProtocol ?? editingConnection.type} editingConnection={editingConnection} onSubmit={handleCreateOrUpdate} onCancel={resetForm} isSubmitting={createMutation.isPending || updateMutation.isPending} />`
    - `handleCreateOrUpdate` should call `createConnection` mutation if no `editingConnection`, otherwise call `updateConnection` mutation with `editingConnection.id`
    - Import `ProtocolSelector` and `ConnectionForm` components
    - _Bug_Condition: protocolSelectorNotRendered() AND connectionFormNotRendered()_
    - _Expected_Behavior: ProtocolSelector renders on "+ New Connection" click, ConnectionForm renders after protocol selection_
    - _Preservation: Cancel button still toggles showProtocolSelector state_
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 3.3 Replace inline connection cards with ConnectionCard component
    - Replace the inline `<div>` card rendering in the connections map with `<ConnectionCard connection={conn} status={status} onEdit={() => handleEdit(conn)} onDelete={() => deleteMutation.mutate(conn.id)} />`
    - Add `handleEdit(conn)` function that sets `editingConnection = conn`, `selectedProtocol = conn.type`, `showProtocolSelector = true`
    - Import `ConnectionCard` component
    - Remove inline `getStatusBadge()` and `getProtocolLabel()` helper functions (no longer needed — ConnectionCard handles its own display)
    - _Bug_Condition: ConnectionCard not rendered, inline divs without Edit/Delete buttons_
    - _Expected_Behavior: ConnectionCard renders with Edit/Delete buttons and protocol/status badges_
    - _Preservation: Connection list still filters by protocol tab selection_
    - _Requirements: 2.3, 2.5, 2.6_

  - [x] 3.4 Integrate MappingTable into ConnectionCard expanded section
    - Update `ConnectionCard` component props interface to accept: `mappings: ConnectorMapping[]`, `currentValues: ConnectorCurrentValue[]`, `allNodes: Array<{ id: string; name: string }>`, `onAddMapping: (data) => void`, `onRemoveMapping: (mappingId: string) => void`
    - Replace the placeholder `<p>` in the `{expanded && ...}` block with `<MappingTable connectionId={connection.id} connectionType={connection.type} mappings={mappings} currentValues={currentValues} allNodes={allNodes} onAddMapping={onAddMapping} onRemoveMapping={onRemoveMapping} />`
    - Import `MappingTable` into `ConnectionCard.tsx`
    - In `ConnectorsManager`, pass filtered mappings (for that connection), currentValues, allNodes, createMapping mutation, and deleteMapping mutation as props to each `ConnectionCard`
    - _Bug_Condition: mappingTableNotRendered() — expanded section shows placeholder text_
    - _Expected_Behavior: MappingTable renders with live values, add/remove functionality_
    - _Preservation: Expand/collapse toggle behavior unchanged_
    - _Requirements: 2.4_

  - [x] 3.5 Add CsvImportExport component to ConnectorsManager toolbar
    - Render `<CsvImportExport onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['connectors-mappings'] })} />` in the toolbar area alongside the filter tabs
    - Import `CsvImportExport` component
    - Position it between the filter tabs and the "+ New Connection" button (or in a separate toolbar row)
    - _Bug_Condition: csvImportExportNotRendered()_
    - _Expected_Behavior: CsvImportExport component renders with Export/Import buttons_
    - _Preservation: Filter tabs layout unchanged_
    - _Requirements: 2.7_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Placeholder UI Instead of Functional Subcomponents
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run: `npx vitest run tests/components/connectors-bug-condition.test.tsx --project components --silent`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed — ProtocolSelector, ConnectionCard, CsvImportExport all render correctly)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Filter Tabs, Loading State, Empty State, and Status Polling
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run: `npx vitest run tests/components/connectors-preservation.test.tsx --project components --silent`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after fix (no regressions in filter tabs, loading state, empty state, status polling)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full component test suite: `npx vitest run --project components --silent`
  - Run existing `connectors-screen.test.tsx` to ensure subcomponent unit tests still pass
  - Verify no TypeScript compilation errors in modified files
  - Ensure all tests pass, ask the user if questions arise.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2"] },
    { "id": 1, "tasks": ["3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "3.5"] },
    { "id": 4, "tasks": ["3.6", "3.7"] },
    { "id": 5, "tasks": ["4"] }
  ]
}
```

## Notes

- Tests use the `components` vitest project with jsdom environment and Testing Library
- Property-based tests within component tests use fast-check for generating random connection data
- The S7 Connection Manager (`web/src/screens/s7/S7ConnectionManager.tsx`) serves as the reference implementation pattern
- All mutations should invalidate relevant query keys to keep the UI in sync
- The `ConnectionCard` component already has Edit/Delete buttons implemented — the fix is about using it instead of inline divs
