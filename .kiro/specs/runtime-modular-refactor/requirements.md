# Requirements Document

## Introduction

Refactor the OPC UA C runtime from a monolithic 1,556-line `main.c` into a modular folder structure organized by domain responsibility. The refactoring replaces global mutable state with a `RuntimeContext` struct, extracts duplicated logic into shared utilities, adopts OpenSSL for base64 decoding, adds structured logging macros, introduces table-driven data type mapping, and ensures recursive object node deletion matches recursive creation. The CMake build and README are updated to reflect the new structure. No functional behavior changes — the runtime continues to serve OPC UA clients identically.

## Glossary

- **Runtime**: The compiled C executable (`opcua-runtime`) that hosts the OPC UA server process
- **RuntimeContext**: A struct aggregating all previously-global mutable state (server handle, config path, status path, TOFU context, running flag, reload flag)
- **Address_Space_Builder**: The module responsible for creating namespace objects, folder hierarchies, and variable nodes from JSON configuration
- **Address_Space_Clearer**: The module responsible for recursively removing all custom nodes before a reload
- **Config_Parser**: The module that reads and validates JSON configuration files
- **Security_Module**: The module configuring OPC UA security policies, PEM→DER conversion, endpoint filtering, and TOFU registration
- **IPC_Module**: The stdin-based inter-process communication subsystem handling value updates and reload commands
- **Status_Writer**: The module writing `status.json` with connected client count and session details
- **Logging_Macros**: Preprocessor macros (`LOG_ERROR`, `LOG_WARN`, `LOG_INFO`) providing structured, categorized log output
- **Data_Type_Table**: A compile-time lookup table mapping OPC UA type name strings to `UA_NS0ID_*` constants and `UA_TYPES` indices
- **NodeId_Parser**: A shared utility parsing `"ns=X;s=StringId"` format strings into `UA_NodeId` values
- **CMakeLists**: The CMake build configuration file listing all source files and targets

## Requirements

### Requirement 1: Module Decomposition

**User Story:** As a developer, I want the runtime split into focused modules by domain, so that I can understand, test, and modify each concern independently.

#### Acceptance Criteria

1. THE Runtime SHALL be organized into the following source directories under `src/`: `config/`, `address_space/`, `ipc/`, `status/`, `security/`, and `util/`
2. THE Runtime `main.c` entry point SHALL contain only argument parsing, lifecycle orchestration, signal/handler setup, and the server run loop, with a maximum of 200 lines of code excluding blank lines and comments
3. WHEN the Runtime is compiled, THE CMakeLists SHALL list every `.c` file from the new directory structure in its source file set and SHALL include `src/` in `target_include_directories` so that headers from any subdirectory are resolvable
4. THE Runtime SHALL expose a `server.c/.h` module containing server creation, the repeated-callback run loop, and shutdown orchestration
5. Each domain directory SHALL contain at least one `.c` file paired with a corresponding `.h` header that declares the module's public interface
6. THE Runtime SHALL place the existing `tofu_verifier.c/.h` files within the `security/` directory
7. WHEN the Runtime is compiled after decomposition, THE build SHALL complete with zero errors and produce the same `opcua-runtime` executable as before the refactor

### Requirement 2: RuntimeContext Struct

**User Story:** As a developer, I want all global mutable state consolidated into a single struct, so that the code is easier to reason about and eventually testable in isolation.

#### Acceptance Criteria

1. THE Runtime SHALL define a `RuntimeContext` struct in `runtime/include/runtime_context.h` containing at minimum: the `UA_Server*` handle, config file path (char array of 4096 bytes), status file path (char array of 4096 bytes), `TofuVerifierContext`, the stdin read buffer (char array of 65536 bytes) and its current length, and references to any platform-specific thread handles required for stdin reading and reload signalling
2. THE Runtime SHALL pass a pointer to `RuntimeContext` through all non-signal-handler functions that currently access global state, including open62541 repeated callbacks (via the `void* data` parameter), stdin processing, status file writing, reload handling, and address space building functions
3. WHEN the Runtime starts, THE `main` function SHALL allocate exactly one `RuntimeContext` instance on the stack, zero-initialize it, populate the config file path from `argv[1]`, derive the status file path, and create the `UA_Server*` — before passing the struct pointer to all subsequent operations
4. THE Runtime SHALL retain only `volatile sig_atomic_t g_running` and `volatile sig_atomic_t g_reload_requested` as file-scope globals, accessible to POSIX signal handlers and the Windows console control handler, with all other mutable state moved into `RuntimeContext`
5. IF compilation succeeds after the refactoring, THEN THE Runtime SHALL produce identical observable behaviour (server startup, reload, stdin value updates, status file writes, and graceful shutdown) to the pre-refactoring version when given the same configuration file

### Requirement 3: Shared NodeId Parser

**User Story:** As a developer, I want duplicated `"ns=X;s=StringId"` parsing consolidated into one utility, so that NodeId parsing logic is defined once and bugs are fixed in one place.

#### Acceptance Criteria

1. THE NodeId_Parser SHALL provide a function `parse_node_id_string(const char *str, UA_NodeId *out_id)` returning an integer status where 0 indicates success and -1 indicates failure
2. WHEN the input string matches the pattern `"ns=<digits>;s=<identifier>"` where digits form a valid UA_UInt16 (0–65535) and identifier is a non-empty string, THE NodeId_Parser SHALL set `out_id` to a `UA_NODEID_STRING` with the parsed namespace index and string identifier
3. IF the input string is NULL, empty, does not start with "ns=", contains a namespace index exceeding 65535, or lacks the ";s=" delimiter followed by at least one character, THEN THE NodeId_Parser SHALL return -1 and leave `out_id` unchanged
4. THE Address_Space_Builder, Address_Space_Clearer, and IPC_Module SHALL use `parse_node_id_string` instead of inline parsing logic

### Requirement 4: OpenSSL Base64 Decoding

**User Story:** As a developer, I want PEM-to-DER conversion to use OpenSSL's base64 implementation, so that the hand-rolled decoder is replaced by a well-tested library already linked by the project.

#### Acceptance Criteria

1. THE Security_Module SHALL use OpenSSL's `EVP_DecodeBlock` or `BIO` base64 functions for PEM-to-DER private key conversion
2. THE Runtime source SHALL not contain a hand-rolled base64 lookup table (e.g., static array mapping ASCII characters to 6-bit values) or manual base64 decoding loop
3. WHEN a PEM-formatted private key is detected (data begins with the ASCII prefix "-----BEGIN"), THE Security_Module SHALL strip the first line (header) and the "-----END" footer line, remove CR and LF characters from the remaining base64 body, decode it using OpenSSL, and produce a DER byte string that is byte-identical to the DER output of the previous inline decoder for the same input
4. IF OpenSSL base64 decoding fails (returns a non-positive decoded length or an error status), THEN THE Security_Module SHALL log an error message indicating the decode failure, free any allocated buffers, and return a failure status (-1) without configuring security policies

### Requirement 5: Recursive Object Node Deletion

**User Story:** As a developer, I want the `clear_address_space` function to delete object nodes recursively to arbitrary depth, so that deletion matches recursive creation and deeply nested nodes are cleaned up correctly.

#### Acceptance Criteria

1. THE Address_Space_Clearer SHALL delete object nodes by recursively traversing the "children" JSON array in the same structure used by `create_object_nodes_recursive`, visiting every descendant at every nesting level present in the configuration
2. WHEN an object node has a non-empty "children" array, THE Address_Space_Clearer SHALL delete all descendant object nodes in post-order (deepest leaves first, then their parents) before deleting the object node itself
3. THE Address_Space_Clearer SHALL delete all variable nodes in a namespace before deleting any object nodes or namespace root nodes within that namespace
4. IF a node targeted for deletion does not exist in the server address space, THEN THE Address_Space_Clearer SHALL skip that node and continue deleting the remaining nodes without interrupting the traversal

### Requirement 6: Structured Logging Macros

**User Story:** As a developer, I want LOG_ERROR, LOG_WARN, and LOG_INFO macros, so that log output is categorized and easy to filter.

#### Acceptance Criteria

1. THE Runtime SHALL define `LOG_ERROR(fmt, ...)`, `LOG_WARN(fmt, ...)`, and `LOG_INFO(fmt, ...)` as variadic macros in the header file `util/logging.h`
2. WHEN `LOG_ERROR` is invoked, THE Logging_Macros SHALL write a single newline-terminated line to `stderr` in the format `[ERROR] <formatted message>\n`
3. WHEN `LOG_WARN` is invoked, THE Logging_Macros SHALL write a single newline-terminated line to `stderr` in the format `[WARN] <formatted message>\n`
4. WHEN `LOG_INFO` is invoked, THE Logging_Macros SHALL write a single newline-terminated line to `stdout` in the format `[INFO] <formatted message>\n`
5. THE Runtime source files SHALL use `LOG_ERROR`, `LOG_WARN`, or `LOG_INFO` instead of direct `printf` or `fprintf` calls for all diagnostic, status, and error messages emitted during server operation
6. IF the format string argument to any logging macro is NULL, THEN THE Logging_Macros SHALL produce no output and shall not cause undefined behavior
7. WHEN any logging macro produces output, THE Logging_Macros SHALL flush the target stream (`stdout` or `stderr`) after writing to ensure the Node.js Process Manager receives each line without buffering delay

### Requirement 7: Table-Driven Data Type Mapping

**User Story:** As a developer, I want data type lookup and initial value creation driven by a static table, so that adding new types requires only a single table entry instead of scattered if-else chains.

#### Acceptance Criteria

1. THE Data_Type_Table SHALL be a static const array of structs where each entry contains: the type name as a null-terminated string, the corresponding `UA_NS0ID_*` numeric identifier, and the `UA_TYPES` array index
2. WHEN `get_data_type_id` is called, THE Address_Space_Builder SHALL perform a linear search over the Data_Type_Table and return the matching `UA_NS0ID_*` value, or `UA_NS0ID_DOUBLE` if no match is found
3. WHEN `create_initial_value` is called with a known numeric type (Int16, Int32, Int64, UInt16, UInt32, UInt64, Float, Double), THE Address_Space_Builder SHALL use the table entry's `UA_TYPES` index to set a zero-initialized default or cast the cJSON number value to the correct C type
4. WHEN `create_initial_value` is called with type "Boolean", THE Address_Space_Builder SHALL interpret the JSON value using `cJSON_IsTrue` and store it as `UA_Boolean`
5. WHEN `create_initial_value` is called with type "String", THE Address_Space_Builder SHALL extract the JSON string via `cJSON_GetStringValue` and store it as `UA_String`
6. THE Data_Type_Table SHALL support all twelve OPC UA types: Boolean, Int16, Int32, Int64, UInt16, UInt32, UInt64, Float, Double, String, DateTime, ByteString

### Requirement 8: Optimized Status File Writes

**User Story:** As a developer, I want the status file written only when session state changes, so that the runtime avoids unnecessary disk I/O every 500ms.

#### Acceptance Criteria

1. THE Status_Writer SHALL track the previously written connected client count and the set of per-session details (applicationName, applicationUri, securityPolicyUri, clientAddress, connectTime, sessionState)
2. WHEN the current connected client count and all per-session details are identical to the previously written state, THE Status_Writer SHALL skip the file write operation
3. WHEN the connected client count changes or any per-session field (applicationName, applicationUri, securityPolicyUri, clientAddress, connectTime, sessionState) differs from the previously written state, THE Status_Writer SHALL write the updated `status.json`
4. WHEN the Status_Writer is invoked and no previous state exists (first invocation after runtime start), THE Status_Writer SHALL write `status.json` unconditionally

### Requirement 9: CMakeLists Update

**User Story:** As a developer, I want the CMake build file updated to compile all new source files, so that the project builds correctly after the refactoring.

#### Acceptance Criteria

1. THE CMakeLists SHALL enumerate all `.c` files from `src/`, `src/config/`, `src/address_space/`, `src/ipc/`, `src/status/`, `src/security/`, and `src/util/` in the `RUNTIME_SOURCES` variable using explicit file listing (not GLOBbing)
2. THE CMakeLists SHALL add `src/`, `src/config/`, `src/address_space/`, `src/ipc/`, `src/status/`, `src/security/`, `src/util/`, and `include/` to the target's `target_include_directories` PRIVATE paths so that headers are resolvable with relative includes
3. WHEN the project is built with `cmake --build .`, THE CMakeLists SHALL produce the `opcua-runtime` binary in the same output location as before (the `runtime/` directory via `RUNTIME_OUTPUT_DIRECTORY`) with no new compiler warnings at `-Wall -Wextra -Wpedantic`
4. THE CMakeLists SHALL retain the existing `target_link_libraries` entries (open62541::open62541, cjson, OpenSSL::SSL, OpenSSL::Crypto) and platform-specific libraries (ws2_32/iphlpapi on Windows, pthread/m on Linux, pthread on macOS) unchanged
5. IF a `.c` file listed in `RUNTIME_SOURCES` does not exist on disk, THEN the CMake configuration step SHALL fail with an error before compilation begins

### Requirement 10: README Update

**User Story:** As a developer, I want the runtime README to reflect the new modular structure, so that contributors can navigate the codebase.

#### Acceptance Criteria

1. THE runtime README SHALL contain a "Project Structure" section with an ASCII directory tree listing every source file under `src/` and every header file under `include/`, matching the actual filesystem contents after refactoring
2. THE runtime README SHALL describe the purpose of each module subdirectory under `src/` in exactly one sentence, placed either inline in the tree or in a list immediately following the tree
3. THE runtime README SHALL contain a "RuntimeContext" subsection that states which header file declares the struct, lists the struct's fields, and explains that it replaces module-level global variables by being passed as a pointer to module initialization functions
