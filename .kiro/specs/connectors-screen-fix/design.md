# Connectors Screen Fix — Bugfix Design

## Overview

The unified Connectors screen (`ConnectorsManager.tsx`) was scaffolded with placeholder elements and inline markup instead of integrating the fully-implemented subcomponents (`ProtocolSelector`, `ConnectionForm`, `ConnectionCard`, `MappingTable`, `CsvImportExport`). Additionally, `ConnectionCard` itself contains a placeholder for the mappings section rather than rendering `MappingTable`. The fix requires wiring these existing components into `ConnectorsManager` with proper state management, TanStack Query mutations, and data fetching — following the same integration pattern proven in the S7 Connection Manager (`S7ConnectionManager.tsx`).

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — user attempts to interact with the Connectors screen (create, edit, delete connections or view mappings) and encounters placeholder UI instead of functional components
- **Property (P)**: The desired behavior — all CRUD operations work through properly integrated subcomponents with live data
- **Preservation**: Protocol filter tabs, loading state, empty state, status polling, and the independent S7 Connection Manager must remain unchanged
- **ConnectorsManager**: The parent screen component in `web/src/screens/connectors/ConnectorsManager.tsx` that orchestrates connection management
- **Subcomponents**: `ProtocolSelector`, `ConnectionForm`, `ConnectionCard`, `MappingTable`, `CsvImportExport` — all fully implemented but not wired into `ConnectorsManager`
- **API Module**: `web/src/api/connectors.ts` — provides `createConnection`, `updateConnection`, `deleteConnection`, `getMappings`, `createMapping`, `deleteMapping`, `getConnectorValues`

## Bug Details

### Bug Condition

The bug manifests when a user attempts any CRUD operation on the Connectors screen. The `ConnectorsManager` component renders placeholder markup and inline `<div>` elements instead of delegating to its purpose-built subcomponents. The `ConnectionCard` component itself also renders placeholder text for the mappings section instead of integrating `MappingTable`.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type UserInteraction on ConnectorsScreen
  OUTPUT: boolean
  
  RETURN (input.action == 'clickNewConnection' AND protocolSelectorNotRendered())
         OR (input.action == 'selectProtocol' AND connectionFormNotRendered())
         OR (input.action == 'expandConnection' AND mappingTableNotRendered())
         OR (input.action == 'clickEdit' AND editFormNotRendered())
         OR (input.action == 'clickDelete' AND deleteMutationNotWired())
         OR (input.action == 'viewScreen' AND csvImportExportNotRendered())
END FUNCTION
```

### Examples

- **Create flow**: User clicks "+ New Connection" → sees `<p>Protocol selection flow (coming soon)</p>` instead of `ProtocolSelector` component with protocol cards
- **Edit flow**: User sees connection cards without Edit/Delete buttons → cannot modify connections because `ConnectionCard` is not used (inline `<div>` cards are rendered instead)
- **Mappings flow**: User expands a connection card → sees "Mappings table placeholder" text instead of `MappingTable` with live values, add/remove functionality
- **CSV flow**: No `CsvImportExport` component is rendered anywhere on the screen — users cannot bulk import/export mappings
- **Delete flow**: Even if buttons were present, no `deleteConnection` mutation is wired in `ConnectorsManager`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Protocol filter tabs (All, S7, Modbus TCP, EtherNet/IP) must continue to filter connections by type
- Loading state must continue to show "Loading connections..." with `aria-live="polite"`
- Empty state must continue to show "No connections configured" when no connections exist and form is hidden
- The S7 Connection Manager screen (`/s7`) must continue to function independently
- Connection status polling every 5 seconds must continue to show real-time status badges

**Scope:**
All interactions that do NOT involve CRUD operations on connections or mappings through the Connectors screen should be completely unaffected. This includes:
- Protocol filter tab switching
- Loading state display
- Empty state display
- S7-specific screen at `/s7`
- Status polling logic (query already exists)

## Hypothesized Root Cause

Based on the code analysis, the root causes are clear and confirmed:

1. **ConnectorsManager does not render ProtocolSelector**: When `showProtocolSelector` is true, a `<div>` with `<p>Protocol selection flow (coming soon)</p>` is rendered instead of `<ProtocolSelector onSelect={...} onCancel={...} />`

2. **ConnectorsManager does not render ConnectionForm**: No state (`selectedProtocol`, `editingConnection`) exists to track when the form should appear. No `createConnection` or `updateConnection` mutations are configured.

3. **ConnectorsManager uses inline cards instead of ConnectionCard**: The connection list maps over connections and renders inline `<div>` elements with only name, protocol label, and status badge — no Edit/Delete buttons, no expand/collapse for mappings.

4. **ConnectionCard does not render MappingTable**: The expanded section shows placeholder text instead of integrating `MappingTable`. Additionally, `ConnectorsManager` does not fetch `getMappings`, `getConnectorValues`, or `getNodes` data needed by `MappingTable`.

5. **CsvImportExport is not rendered**: The component exists but is never mounted in `ConnectorsManager`.

6. **No mutations are configured**: `ConnectorsManager` has no `useMutation` hooks for `createConnection`, `updateConnection`, `deleteConnection`, `createMapping`, or `deleteMapping`.

## Correctness Properties

Property 1: Bug Condition - Subcomponent Integration

_For any_ user interaction on the Connectors screen that involves creating, editing, deleting connections, viewing mappings, or importing/exporting CSV, the fixed `ConnectorsManager` SHALL render the appropriate fully-implemented subcomponent (`ProtocolSelector`, `ConnectionForm`, `ConnectionCard`, `MappingTable`, `CsvImportExport`) and wire it to the corresponding API mutation, producing the same level of functionality as the S7 Connection Manager reference implementation.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

Property 2: Preservation - Existing UI Behaviors

_For any_ interaction that does NOT involve CRUD operations (protocol tab filtering, loading state, empty state, independent S7 screen, status polling), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing non-CRUD functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `web/src/screens/connectors/ConnectorsManager.tsx`

**Specific Changes**:

1. **Add state management for connection form flow**:
   - Add `selectedProtocol: string | null` state to track protocol selection from `ProtocolSelector`
   - Add `editingConnection: ConnectorConnection | null` state for edit mode
   - Add `deleteConnId: string | null` state for delete confirmation tracking (delegated to `ConnectionCard`)

2. **Add TanStack Query data fetches**:
   - Add `useQuery` for `getMappings()` (all mappings)
   - Add `useQuery` for `getConnectorValues()` with `refetchInterval: 2000` (live values)
   - Add `useQuery` for `getNodes()` (for mapping node selector)
   - Import `useQueryClient` for cache invalidation

3. **Add TanStack Query mutations**:
   - `useMutation` for `createConnection` → invalidate `['connectors-connections']` and reset form state
   - `useMutation` for `updateConnection` → invalidate `['connectors-connections']` and reset form state
   - `useMutation` for `deleteConnection` → invalidate `['connectors-connections']` and `['connectors-mappings']`
   - `useMutation` for `createMapping` → invalidate `['connectors-mappings']`
   - `useMutation` for `deleteMapping` → invalidate `['connectors-mappings']`

4. **Replace protocol selector placeholder with `ProtocolSelector` component**:
   - When `showProtocolSelector` is true and `selectedProtocol` is null, render `<ProtocolSelector onSelect={setSelectedProtocol} onCancel={resetForm} />`
   - When `selectedProtocol` is set (or `editingConnection` is set), render `<ConnectionForm type={...} editingConnection={...} onSubmit={...} onCancel={resetForm} />`

5. **Replace inline cards with `ConnectionCard` component**:
   - Replace the inline `<div>` card elements with `<ConnectionCard connection={conn} status={...} onEdit={...} onDelete={...} />`
   - Pass `onEdit` callback that sets `editingConnection` and `showConnForm`
   - Pass `onDelete` callback that calls `deleteConnection` mutation

6. **Integrate `MappingTable` into `ConnectionCard`**:
   - `ConnectionCard` must render `<MappingTable ...props />` in its expanded section instead of placeholder text
   - Pass `connectionId`, `connectionType`, `mappings`, `currentValues`, `allNodes`, `onAddMapping`, `onRemoveMapping` props
   - This requires either passing these as props to `ConnectionCard` or refactoring `ConnectionCard` to accept a `children` or `renderMappings` slot

7. **Add `CsvImportExport` component to the toolbar area**:
   - Render `<CsvImportExport onImportComplete={invalidateMappings} />` alongside the filter tabs and "New Connection" button

**File**: `web/src/screens/connectors/ConnectionCard.tsx`

**Specific Changes**:

1. **Replace mappings placeholder with MappingTable integration**:
   - Add props for mapping data: `mappings`, `currentValues`, `allNodes`, `onAddMapping`, `onRemoveMapping`
   - Replace the placeholder `<p>` in the expanded section with `<MappingTable connectionId={connection.id} connectionType={connection.type} mappings={mappings} currentValues={currentValues} allNodes={allNodes} onAddMapping={onAddMapping} onRemoveMapping={onRemoveMapping} />`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write React component tests using Testing Library that render `ConnectorsManager` and attempt CRUD interactions. Run these tests on the UNFIXED code to observe failures and confirm the root cause.

**Test Cases**:
1. **Protocol Selector Test**: Render `ConnectorsManager`, click "+ New Connection", assert `ProtocolSelector` is rendered with protocol cards (will fail on unfixed code — finds placeholder text instead)
2. **Connection Form Test**: After selecting a protocol, assert `ConnectionForm` renders with protocol-specific fields (will fail on unfixed code — no form rendered)
3. **Connection Card Test**: With mock connections, assert `ConnectionCard` components render with Edit/Delete buttons (will fail on unfixed code — inline divs without buttons)
4. **Mapping Table Test**: Expand a connection card, assert `MappingTable` renders with device address column and add-mapping form (will fail on unfixed code — placeholder text)
5. **CSV Import/Export Test**: Assert `CsvImportExport` component is present on the screen (will fail on unfixed code — not rendered)

**Expected Counterexamples**:
- `ProtocolSelector` component never appears in the rendered output
- No `ConnectionForm` is rendered regardless of user actions
- Connection cards lack Edit/Delete buttons
- Expanded cards show "Mappings table placeholder" instead of table structure

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL interaction WHERE isBugCondition(interaction) DO
  result := renderConnectorsManager_fixed(interaction)
  ASSERT expectedSubcomponentRendered(result, interaction)
  ASSERT mutationCalledCorrectly(result, interaction)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL interaction WHERE NOT isBugCondition(interaction) DO
  ASSERT renderConnectorsManager_original(interaction).visibleUI 
       = renderConnectorsManager_fixed(interaction).visibleUI
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many filter combinations to verify tab switching works correctly
- It tests various connection list states (empty, single, many) with random protocol types
- It verifies status badge rendering across all possible status states

**Test Plan**: Observe behavior on UNFIXED code first for filter tabs and status display, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Filter Tab Preservation**: Verify filter tabs continue to filter connections by protocol type — observe on unfixed code, then assert same behavior after fix
2. **Loading State Preservation**: Verify "Loading connections..." message appears during data fetch in both original and fixed code
3. **Empty State Preservation**: Verify "No connections configured" message when no connections exist in both versions
4. **Status Polling Preservation**: Verify status badges update every 5 seconds in both versions

### Unit Tests

- Test `ProtocolSelector` renders protocol cards and calls `onSelect` with correct type string
- Test `ConnectionForm` renders protocol-specific fields based on `type` prop
- Test `ConnectionCard` renders Edit/Delete buttons and calls callbacks
- Test `MappingTable` renders mapping rows with live values
- Test `CsvImportExport` calls export/import API functions

### Property-Based Tests

- Generate random connection lists with random protocol types → verify all are rendered with `ConnectionCard` component and correct protocol badges
- Generate random filter selections → verify filtered list matches expected subset
- Generate random mapping configurations → verify `MappingTable` renders correct number of rows with proper device addresses

### Integration Tests

- Test full create flow: click New → select protocol → fill form → submit → verify connection appears in list
- Test full edit flow: click Edit → modify fields → submit → verify connection updated
- Test full delete flow: click Delete → confirm → verify connection removed from list
- Test mappings flow: expand card → add mapping → verify it appears in table → remove → verify removed
- Test CSV flow: export → verify download triggered; import file → verify mappings updated
