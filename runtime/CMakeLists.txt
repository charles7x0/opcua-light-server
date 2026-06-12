cmake_minimum_required(VERSION 3.16)
project(opcua-runtime C)

# ─── C Standard ───────────────────────────────────────────────────────────────
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

# ─── Compiler Warnings ───────────────────────────────────────────────────────
if(MSVC)
    add_compile_options(/W4)
else()
    add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# ─── Dependencies via FetchContent ───────────────────────────────────────────
include(FetchContent)

# open62541 - OPC UA stack
FetchContent_Declare(
    open62541
    GIT_REPOSITORY https://github.com/open62541/open62541.git
    GIT_TAG        v1.3.9
    GIT_SHALLOW    TRUE
)
set(UA_ENABLE_AMALGAMATION OFF CACHE BOOL "" FORCE)
set(UA_ENABLE_ENCRYPTION "OPENSSL" CACHE STRING "" FORCE)
set(UA_FORCE_WERROR OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(open62541)

# OpenSSL - Required for OPC UA security policies (Sign / SignAndEncrypt)
find_package(OpenSSL REQUIRED)

# cJSON - Lightweight JSON parser for C
FetchContent_Declare(
    cjson
    GIT_REPOSITORY https://github.com/DaveGamble/cJSON.git
    GIT_TAG        v1.7.17
    GIT_SHALLOW    TRUE
)
set(ENABLE_CJSON_TEST OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_AND_STATIC_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(cjson)

# ─── Source Files ────────────────────────────────────────────────────────────
set(RUNTIME_SOURCES
    src/main.c
    src/tofu_verifier.c
)

# ─── Executable ──────────────────────────────────────────────────────────────
add_executable(opcua-runtime ${RUNTIME_SOURCES})

target_link_libraries(opcua-runtime
    PRIVATE
        open62541::open62541
        cjson
        OpenSSL::SSL
        OpenSSL::Crypto
)

target_include_directories(opcua-runtime
    PRIVATE
        ${cjson_SOURCE_DIR}
)

# ─── Platform-specific link libraries ────────────────────────────────────────
if(WIN32)
    target_link_libraries(opcua-runtime PRIVATE ws2_32 iphlpapi)
elseif(UNIX AND NOT APPLE)
    target_link_libraries(opcua-runtime PRIVATE pthread m)
elseif(APPLE)
    target_link_libraries(opcua-runtime PRIVATE pthread)
endif()

# ─── Output Binary Path ─────────────────────────────────────────────────────
# Place the compiled binary in the runtime/ directory (CMAKE_SOURCE_DIR) so the
# Node.js Process Manager can locate it at:
#   - Linux/macOS: runtime/opcua-runtime
#   - Windows:     runtime/opcua-runtime.exe
#
# The Process Manager uses DEFAULT_RUNTIME_PATH = 'runtime/opcua-runtime' which
# is relative to the project root. Since CMAKE_SOURCE_DIR points to runtime/,
# the binary lands exactly where expected.
set_target_properties(opcua-runtime PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_SOURCE_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_SOURCE_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_SOURCE_DIR}"
    RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_SOURCE_DIR}"
    OUTPUT_NAME "opcua-runtime"
)

# ─── Install Target (optional) ───────────────────────────────────────────────
install(TARGETS opcua-runtime RUNTIME DESTINATION bin)
