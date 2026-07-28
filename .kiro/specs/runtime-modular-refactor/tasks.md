# Implementation Plan: Runtime Modular Refactor

## Overview

Decompose the monolithic `runtime/src/main.c` (1,556 lines) into a modular directory structure organized by domain responsibility. The refactoring is purely structural — no functional behavior changes. Implementation proceeds bottom-up: shared utilities first, then domain modules, then orchestration (server.c, main.c), and finally build/documentation updates.

## Tasks

- [x] 1. Create directory structure and shared utility modules
  - [x] 1.1 Create directory layout and implement `util/logging.h`
    - Create directories: `runtime/include/`, `runtime/src/config/`, `runtime/src/address_space/`, `runtime/src/ipc/`, `runtime/src/status/`, `runtime/src/security/`, `runtime/src/util/`
    - Create `runtime/src/util/logging.h` with `LOG_ERROR`, `LOG_WARN`, `LOG_INFO` variadic macros
    - `LOG_ERROR`/`LOG_WARN` write to stderr, `LOG_INFO` writes to stdout
    - Each macro flushes the stream after writing and guards against NULL format strings
    - _Requirements: 1.1, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7_

  - [x] 1.2 Write property test for logging macros
    - **Property 5: Logging macros produce correctly prefixed output**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.7**
    - Test via subprocess invocation: compile a small C program that calls each macro with random format strings, capture stdout/stderr, verify prefix and newline format

  - [x] 1.3 Implement `util/node_id_parser.c` and `util/node_id_parser.h`
    - Implement `parse_node_id_string(const char *str, UA_NodeId *out_id)` returning 0 on success, -1 on failure
    - Parse `"ns=<digits>;s=<identifier>"` format, validate namespace range [0, 65535], require non-empty identifier
    - Return -1 for NULL, empty, missing `ns=` prefix, namespace > 65535, missing `;s=` delimiter, or empty identifier
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 1.4 Write property test for NodeId parsing round-trip
    - **Property 1: NodeId parsing round-trip**
    - **Validates: Requirements 3.2, 3.3**
    - Generate random valid (ns ∈ [0,65535], id ∈ non-empty ASCII strings) and invalid inputs via fast-check
    - Test via native addon or subprocess with JSON I/O

  - [x] 1.5 Implement `util/file_io.c` and `util/file_io.h`
    - Implement `file_read_text(const char *path)` returning malloc'd string or NULL
    - Implement `file_read_binary(const char *path)` returning `UA_ByteString` or `UA_BYTESTRING_NULL`
    - Use `LOG_ERROR` for all error messages instead of raw fprintf
    - _Requirements: 1.1, 1.5_

  - [x] 1.6 Write unit tests for file_io utilities
    - Test `file_read_text` with valid file, empty file, and non-existent file
    - Test `file_read_binary` with valid binary file and non-existent file
    - _Requirements: 1.5_

- [x] 2. Implement RuntimeContext and data type table
  - [x] 2.1 Create `include/runtime_context.h`
    - Define `RuntimeContext` struct with: `UA_Server *server`, `config_path[4096]`, `status_path[4096]`, `TofuVerifierContext tofu_ctx`, `stdin_buffer[65536]`, `stdin_buffer_len`, `last_status_json` pointer, and Windows-specific thread handles/queue under `#ifdef _WIN32`
    - Include proper forward declarations and include guards
    - _Requirements: 2.1, 2.4_

  - [x] 2.2 Create `address_space/data_type_table.h`
    - Define `DataTypeEntry` struct with `name`, `ns0_id`, `ua_types_index`
    - Define static const `DATA_TYPE_TABLE` array with all 12 OPC UA types (Boolean, Int16, Int32, Int64, UInt16, UInt32, UInt64, Float, Double, String, DateTime, ByteString)
    - Define `DATA_TYPE_TABLE_SIZE` macro
    - _Requirements: 7.1, 7.6_

  - [x] 2.3 Write property test for data type table lookup
    - **Property 6: Data type table lookup correctness**
    - **Validates: Requirements 7.2**
    - Generate random strings; for the 12 known type names verify correct UA_NS0ID return; for arbitrary strings verify UA_NS0ID_DOUBLE default

- [x] 3. Checkpoint - Ensure shared utilities compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement config and address space modules
  - [x] 4.1 Implement `config/config_parser.c` and `config/config_parser.h`
    - Implement `config_parse_file(const char *path)` that reads file via `file_read_text`, parses JSON via cJSON, validates `namespaces` array presence
    - Return cJSON root on success (caller frees), NULL on error with LOG_ERROR messages
    - _Requirements: 1.1, 1.5_

  - [x] 4.2 Implement `address_space/address_space_builder.c` and `address_space/address_space_builder.h`
    - Implement `address_space_build(UA_Server *server, cJSON *config)` returning 0 on success, -1 on error
    - Extract namespace registration, `create_object_nodes_recursive`, `create_variable_node` logic from main.c
    - Use `parse_node_id_string` from util instead of inline parsing
    - Use `DATA_TYPE_TABLE` for `get_data_type_id` (linear search) and table-driven `create_initial_value`
    - Replace fprintf/printf with LOG_WARN/LOG_INFO
    - _Requirements: 1.1, 3.4, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.3 Write property test for initial value creation
    - **Property 7: Initial value creation preserves type and value**
    - **Validates: Requirements 7.3, 7.5**
    - Generate random (type, value) pairs within type ranges, verify UA_Variant data type and stored value match

  - [x] 4.4 Implement `address_space/address_space_clearer.c` and `address_space/address_space_clearer.h`
    - Implement `address_space_clear(UA_Server *server, const char *config_path)` with recursive deletion
    - Delete variable nodes first, then object nodes in post-order (deepest leaves first)
    - Use `parse_node_id_string` for node ID construction
    - Skip non-existent nodes gracefully, log errors on config read failure
    - _Requirements: 3.4, 5.1, 5.2, 5.3, 5.4_

  - [x] 4.5 Write property test for recursive deletion order
    - **Property 3: Recursive deletion is post-order and exhaustive**
    - **Validates: Requirements 5.1, 5.2**
    - Generate random trees (depth 1–5, branching 0–4), record deletion order via mock, verify post-order and completeness

  - [x] 4.6 Write property test for variable-before-object deletion
    - **Property 4: Variable nodes deleted before object nodes**
    - **Validates: Requirements 5.3**
    - Generate configs with random mixes of variable and object nodes, verify all variable deletions precede object deletions

- [x] 5. Implement IPC, status, and security modules
  - [x] 5.1 Implement `ipc/ipc_processor.c` and `ipc/ipc_processor.h`
    - Implement `ipc_init(RuntimeContext *ctx)`, `ipc_process(RuntimeContext *ctx)`, `ipc_shutdown(RuntimeContext *ctx)`
    - Extract stdin reading logic (non-blocking on POSIX, threaded on Windows), JSON parsing, and value update application
    - Use `parse_node_id_string` for node ID parsing in value updates
    - Use `RuntimeContext` instead of globals for buffer state and thread handles
    - _Requirements: 1.1, 2.2, 3.4_

  - [x] 5.2 Implement `status/status_writer.c` and `status/status_writer.h`
    - Implement `status_write_if_changed(RuntimeContext *ctx)` with change detection
    - Build JSON via cJSON, serialize to string, compare with `ctx->last_status_json`
    - Write file only if JSON differs or first invocation (last_status_json is NULL)
    - Update `ctx->last_status_json` on successful write
    - _Requirements: 1.1, 2.2, 8.1, 8.2, 8.3, 8.4_

  - [x] 5.3 Write property test for status write change detection
    - **Property 8: Status write occurs if and only if state changed**
    - **Validates: Requirements 8.2, 8.3**
    - Generate random session states; verify file write occurs iff state changed between invocations

  - [x] 5.4 Implement `security/security_config.c` and `security/security_config.h`
    - Implement `security_configure(RuntimeContext *ctx, cJSON *security_json)` returning 0 on success, -1 on error
    - Replace hand-rolled base64 with OpenSSL `EVP_DecodeBlock` for PEM-to-DER conversion
    - Strip PEM header/footer lines, remove CR/LF from base64 body, decode via EVP_DecodeBlock
    - Handle decode failure (non-positive return) with LOG_ERROR and return -1
    - Move `tofu_verifier.c/.h` to `security/` directory
    - _Requirements: 1.1, 1.6, 2.2, 4.1, 4.2, 4.3, 4.4_

  - [x] 5.5 Write property test for PEM-to-DER round-trip
    - **Property 2: PEM-to-DER base64 decode round-trip**
    - **Validates: Requirements 4.3**
    - Generate random byte sequences (1–4096 bytes), encode as base64 with PEM wrapping, verify decode produces original bytes

- [x] 6. Checkpoint - Ensure domain modules compile independently
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement server orchestration and refactor main.c
  - [x] 7.1 Implement `server.c` and `server.h`
    - Implement `server_create(RuntimeContext *ctx)`, `server_run(RuntimeContext *ctx)`, `server_shutdown(RuntimeContext *ctx)`
    - Server creation: call config_parse_file, security_configure, address_space_build
    - Run loop: register repeated callbacks for ipc_process and status_write_if_changed, handle reload via address_space_clear + rebuild
    - Shutdown: ipc_shutdown, free last_status_json, UA_Server_delete
    - Pass `RuntimeContext*` via the `void *data` parameter in repeated callbacks
    - _Requirements: 1.4, 2.2, 2.3, 2.5_

  - [x] 7.2 Refactor `main.c` to entry-point-only (~150 lines)
    - Keep only: argument parsing, RuntimeContext stack allocation and zero-init, signal handler setup, config_path/status_path population, server_create/server_run/server_shutdown calls
    - Retain `volatile sig_atomic_t g_running` and `volatile sig_atomic_t g_reload_requested` as file-scope globals
    - Remove all extracted logic (file I/O, config parsing, address space, IPC, status, security code)
    - Replace all printf/fprintf with LOG_ERROR/LOG_WARN/LOG_INFO
    - _Requirements: 1.2, 2.3, 2.4, 6.5_

  - [x] 7.3 Write unit tests for main.c argument validation
    - Test missing argv[1] prints usage and exits with EXIT_FAILURE
    - Test valid argv[1] populates config_path correctly
    - _Requirements: 1.2, 2.3_

- [x] 8. Update build system and documentation
  - [x] 8.1 Update `CMakeLists.txt` with new source files and include paths
    - List all new `.c` files explicitly in `RUNTIME_SOURCES` (no GLOBbing)
    - Add `src/`, `src/config/`, `src/address_space/`, `src/ipc/`, `src/status/`, `src/security/`, `src/util/`, and `include/` to `target_include_directories PRIVATE`
    - Retain all existing `target_link_libraries` and platform-specific libraries unchanged
    - Retain output directory and binary name settings unchanged
    - _Requirements: 1.3, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.2 Verify full build compiles with zero warnings
    - Run `cmake --build .` and confirm zero errors and zero warnings at `-Wall -Wextra -Wpedantic`
    - Confirm output binary is `opcua-runtime` in the `runtime/` directory
    - _Requirements: 1.7, 9.3_

  - [x] 8.3 Update runtime README with new project structure
    - Add "Project Structure" section with ASCII directory tree listing all source and header files
    - Describe the purpose of each module subdirectory in one sentence
    - Add "RuntimeContext" subsection documenting the struct's header location, fields, and design rationale
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The C runtime is tested via subprocess invocation with JSON I/O or native addon, since the project already uses fast-check for TypeScript testing
- Signal globals (`g_running`, `g_reload_requested`) remain file-scope per design — POSIX signal handlers cannot receive user data

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5"] },
    { "id": 2, "tasks": ["1.4", "1.6", "2.3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.4"] },
    { "id": 4, "tasks": ["4.3", "4.5", "4.6", "5.1", "5.2", "5.4"] },
    { "id": 5, "tasks": ["5.3", "5.5"] },
    { "id": 6, "tasks": ["7.1"] },
    { "id": 7, "tasks": ["7.2", "7.3"] },
    { "id": 8, "tasks": ["8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3"] }
  ]
}
```
