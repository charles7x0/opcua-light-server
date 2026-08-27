# Release Notes

## v0.2.0

### Features

**Connector Plugin Architecture**
- Dynamic plugin discovery at startup — new protocols added by dropping a folder, no core changes required
- Abstract `BaseConnector<TClient, TManaged>` base class eliminates boilerplate across all protocol connectors
- `GET /api/connectors/protocols` endpoint returns protocol metadata and parameter schemas
- Dynamic form rendering in the frontend from `paramsSchema` (text, number, boolean, select fields)
- Connection parameter validation against protocol schemas on create/update
- External plugins directory support via `CONNECTOR_PLUGINS_DIR` environment variable

**Security Improvements**
- Runtime now restarts automatically after security mode change (Sign/SignAndEncrypt enforcement)
- SignAndEncrypt mode properly rejects None connections (endpoint filtering + policy enforcement)
- API rejects mode change to Sign/SignAndEncrypt without a certificate configured
- Guided UX: inline prompt to generate a certificate when selecting a secure mode without one
- Client Certificate Trust (TOFU) section documented in README

**Connector UX Improvements**
- Color-coded left border on connection cards (green/red/gray) for instant status scanning
- Host/IP displayed on connection card header for quick identification
- Mapping count visible on collapsed cards
- Enable/disable toggle switch directly on each connection card
- Better empty state with visual cue and prominent CTA
- Auto-expand connection cards when 2 or fewer connections exist
- Fixed stale form state when switching between editing different connections

**Docker Support**
- Multi-stage Dockerfile (Alpine-based, ~150 MB final image)
- Builds API, web UI, and C runtime in isolated stages
- Supports both amd64 and arm64 platforms
- Health check on `/api/server/status`
- Node.js memory optimization (`--max-old-space-size=128`)

**Developer Experience**
- `npm run reset` — cross-platform script to reset runtime data (database, certificates, PKI)
- OpenAPI spec (`docs/openapi.json`) updated to match current API surface
- Swagger UI available at `/api/docs`

### Bug Fixes

- **Security mode not enforced**: C runtime now removes None security policy endpoints in SignAndEncrypt mode, preventing unencrypted client connections
- **Quality not propagated to OPC UA nodes**: IPC processor now writes `BadNotConnected` status code when connector quality is "bad", and restores `Good` on successful polls
- **Plugin loader fails in dev mode**: Added `.ts` entry point fallback for `tsx watch` compatibility
- **ConnectionForm stale state**: Added React `key` prop to force remount when switching between editing different connections
- **ConfigGenerator silent fallback**: Security mode silently fell back to None when PKI directories were missing — now blocked at the API level with clear error messages
- **GetEndpoints discovery broken**: Reverted removal of None security policy (needed for discovery service), only removes None session endpoints

### Refactoring

- Extracted `BaseConnector` abstract class — each protocol connector reduced from ~350-420 lines to ~80-120 lines of protocol-specific code
- Reorganized `src/connectors/` into `core/` (framework) and `protocols/` (plugins) subfolders
- Removed legacy S7 screen (`web/src/screens/s7/`), S7 API client (`web/src/api/s7.ts`), S7 alias routes, and S7Repository
- Removed unused `NodeRepository`/`NamespaceRepository` from ConfigGenerator constructor
- Moved `detectPrimaryIp()` to shared `src/utils/network.ts`
- Removed dead S7 type definitions from `src/types/`
- Removed stale S7 query keys from `useSSE` hook
- Cleaned connectors barrel to only export framework modules (no individual connector re-exports)

### Documentation

- README: fixed encoding corruption, added Docker section, added TOFU explanation, updated project structure
- OpenAPI spec: removed deprecated `/api/s7/*` endpoints, added `/api/connectors/*` and `/api/events`
- Steering files updated with current project structure and conventions
