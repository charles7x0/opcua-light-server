#include "server.h"
#include "config/config_parser.h"
#include "security/security_config.h"
#include "address_space/address_space_builder.h"
#include "address_space/address_space_clearer.h"
#include "ipc/ipc_processor.h"
#include "status/status_writer.h"
#include "util/logging.h"

#include <open62541/server_config_default.h>
#include <cJSON.h>

#include <stdlib.h>
#include <string.h>
#include <signal.h>

#ifdef _WIN32
#include <windows.h>
#include <process.h>
#endif

/* ─── External signal flags (defined in main.c) ────────────────────────────── */

extern volatile sig_atomic_t g_running;
extern volatile sig_atomic_t g_reload_requested;

/* ─── Windows pipe listener for reload signals ─────────────────────────────── */

#ifdef _WIN32
static unsigned __stdcall win32_pipe_listener(void *arg) {
    RuntimeContext *ctx = (RuntimeContext *)arg;
    char pipe_name[256];
    snprintf(pipe_name, sizeof(pipe_name),
             "\\\\.\\pipe\\opcua-runtime-%lu", (unsigned long)GetCurrentProcessId());

    LOG_INFO("Named pipe listener started: %s", pipe_name);

    while (InterlockedCompareExchange(&ctx->pipe_running, 1, 1)) {
        HANDLE pipe = CreateNamedPipeA(
            pipe_name,
            PIPE_ACCESS_INBOUND,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
            1,       /* max instances */
            256,     /* out buffer size */
            256,     /* in buffer size */
            1000,    /* default timeout ms */
            NULL     /* security attributes */
        );

        if (pipe == INVALID_HANDLE_VALUE) {
            LOG_ERROR("Failed to create named pipe (error %lu)",
                      (unsigned long)GetLastError());
            Sleep(1000);
            continue;
        }

        /* Wait for a client to connect (blocking) */
        BOOL connected = ConnectNamedPipe(pipe, NULL)
                         ? TRUE
                         : (GetLastError() == ERROR_PIPE_CONNECTED);

        if (!connected || !InterlockedCompareExchange(&ctx->pipe_running, 1, 1)) {
            CloseHandle(pipe);
            continue;
        }

        /* Read the message */
        char buffer[256] = {0};
        DWORD bytes_read = 0;
        BOOL success = ReadFile(pipe, buffer, sizeof(buffer) - 1, &bytes_read, NULL);

        if (success && bytes_read > 0) {
            buffer[bytes_read] = '\0';
            /* Trim trailing whitespace/newlines */
            while (bytes_read > 0 &&
                   (buffer[bytes_read - 1] == '\n' ||
                    buffer[bytes_read - 1] == '\r' ||
                    buffer[bytes_read - 1] == ' ')) {
                buffer[--bytes_read] = '\0';
            }

            if (strcmp(buffer, "reload") == 0) {
                LOG_INFO("Reload signal received via named pipe.");
                g_reload_requested = 1;
            } else {
                LOG_WARN("Unknown pipe command: '%s'", buffer);
            }
        }

        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }

    return 0;
}
#endif

/* ─── Reload handler ───────────────────────────────────────────────────────── */

static void handle_reload(RuntimeContext *ctx) {
    LOG_INFO("Reload requested. Re-reading config from: %s", ctx->config_path);

    cJSON *config = config_parse_file(ctx->config_path);
    if (!config) {
        LOG_ERROR("Failed to parse config file during reload");
        return;
    }

    address_space_clear(ctx->server, ctx->config_path);

    if (address_space_build(ctx->server, config) != 0) {
        LOG_ERROR("Failed to rebuild address space during reload");
    } else {
        LOG_INFO("Reload complete. Address space rebuilt successfully.");
    }

    cJSON_Delete(config);
}

/* ─── Server iteration repeated callback ───────────────────────────────────── */

static void server_iteration_callback(UA_Server *server, void *data) {
    (void)server;
    RuntimeContext *ctx = (RuntimeContext *)data;

    if (g_reload_requested) {
        g_reload_requested = 0;
        handle_reload(ctx);
    }

    status_write_if_changed(ctx);
    ipc_process(ctx);
}

/* ─── Public API ───────────────────────────────────────────────────────────── */

int server_create(RuntimeContext *ctx) {
    /* 1. Parse config file */
    cJSON *config = config_parse_file(ctx->config_path);
    if (!config) {
        LOG_ERROR("Failed to parse config file: %s", ctx->config_path);
        return -1;
    }

    /* 2. Create UA_Server */
    ctx->server = UA_Server_new();
    if (!ctx->server) {
        LOG_ERROR("Failed to create UA_Server");
        cJSON_Delete(config);
        return -1;
    }

    /* 3. Configure security */
    cJSON *security = cJSON_GetObjectItemCaseSensitive(config, "security");
    if (security_configure(ctx, security) != 0) {
        LOG_ERROR("Security configuration failed");
        UA_Server_delete(ctx->server);
        ctx->server = NULL;
        cJSON_Delete(config);
        return -1;
    }

    LOG_INFO("OPC UA server configured");

    /* 4. Build address space */
    LOG_INFO("Building address space...");
    if (address_space_build(ctx->server, config) != 0) {
        LOG_ERROR("Failed to build address space");
        UA_Server_delete(ctx->server);
        ctx->server = NULL;
        cJSON_Delete(config);
        return -1;
    }

    LOG_INFO("Address space built successfully.");

    /* 5. Free config */
    cJSON_Delete(config);

    return 0;
}

UA_StatusCode server_run(RuntimeContext *ctx) {
    /* 1. Initialize IPC */
    ipc_init(ctx);

    /* 2. Start Windows pipe listener thread for reload signals */
#ifdef _WIN32
    ctx->pipe_running = 1;
    ctx->pipe_thread = (HANDLE)_beginthreadex(NULL, 0, win32_pipe_listener, ctx, 0, NULL);
    if (!ctx->pipe_thread) {
        LOG_WARN("Failed to start named pipe listener thread");
    }
#endif

    /* 3. Register repeated callback (500ms interval) */
    UA_Server_addRepeatedCallback(ctx->server, server_iteration_callback,
                                  ctx, 500.0, NULL);

    /* 4. Run the server (blocks until g_running becomes false) */
    LOG_INFO("Starting OPC UA server on port 4840...");
    UA_StatusCode status = UA_Server_run(ctx->server, (volatile UA_Boolean *)&g_running);

    return status;
}

void server_shutdown(RuntimeContext *ctx) {
    LOG_INFO("Server shutting down...");

    /* 1. Shutdown IPC */
    ipc_shutdown(ctx);

    /* 2. Stop Windows pipe listener thread */
#ifdef _WIN32
    InterlockedExchange(&ctx->pipe_running, 0);
    if (ctx->pipe_thread) {
        WaitForSingleObject(ctx->pipe_thread, 2000);
        CloseHandle(ctx->pipe_thread);
        ctx->pipe_thread = NULL;
    }
#endif

    /* 3. Free last_status_json if non-NULL */
    if (ctx->last_status_json) {
        free(ctx->last_status_json);
        ctx->last_status_json = NULL;
    }

    /* 4. Delete the UA_Server */
    if (ctx->server) {
        UA_Server_delete(ctx->server);
        ctx->server = NULL;
    }

    LOG_INFO("Server shutdown complete.");
}
