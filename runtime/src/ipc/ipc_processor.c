#include "ipc_processor.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#include <process.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

#include <open62541/server.h>
#include <cJSON.h>

#include "util/logging.h"
#include "util/node_id_parser.h"

/* ─── Constants ────────────────────────────────────────────────────────────── */

#define STDIN_QUEUE_SIZE 256

/* ─── Static Helpers ───────────────────────────────────────────────────────── */

/**
 * Parse and apply a single value update JSON message.
 * Expected format: {"type":"value_update","updates":[{"nodeId":"...","value":...},...]}
 * Also handles: {"type":"trust_store_reload"}
 */
static void apply_value_update(UA_Server *server, const char *json_line) {
    cJSON *root = cJSON_Parse(json_line);
    if (!root) return;

    cJSON *type_item = cJSON_GetObjectItemCaseSensitive(root, "type");
    const char *type_str = cJSON_GetStringValue(type_item);
    if (!type_str) {
        cJSON_Delete(root);
        return;
    }

    /* Handle trust_store_reload IPC message */
    if (strcmp(type_str, "trust_store_reload") == 0) {
        LOG_INFO("[TOFU] Trust store reload requested via IPC");
        cJSON_Delete(root);
        return;
    }

    if (strcmp(type_str, "value_update") != 0) {
        cJSON_Delete(root);
        return;
    }

    cJSON *updates = cJSON_GetObjectItemCaseSensitive(root, "updates");
    if (!cJSON_IsArray(updates)) {
        cJSON_Delete(root);
        return;
    }

    cJSON *update = NULL;
    cJSON_ArrayForEach(update, updates) {
        cJSON *node_id_item = cJSON_GetObjectItemCaseSensitive(update, "nodeId");
        cJSON *value_item = cJSON_GetObjectItemCaseSensitive(update, "value");
        cJSON *quality_item = cJSON_GetObjectItemCaseSensitive(update, "quality");

        const char *node_id_str = cJSON_GetStringValue(node_id_item);
        if (!node_id_str) continue;

        /* Parse the nodeId using shared utility */
        UA_NodeId nodeId = UA_NODEID_NULL;
        if (parse_node_id_string(node_id_str, &nodeId) != 0) {
            continue;
        }

        /* Check quality field — if "bad", write BadNotConnected status without changing value */
        const char *quality_str = cJSON_GetStringValue(quality_item);
        if (quality_str && strcmp(quality_str, "bad") == 0) {
            /* Write BadNotConnected status code to the node */
            UA_WriteValue wv;
            UA_WriteValue_init(&wv);
            wv.nodeId = nodeId;
            wv.attributeId = UA_ATTRIBUTEID_VALUE;
            wv.value.hasStatus = UA_TRUE;
            wv.value.status = UA_STATUSCODE_BADNOTCONNECTED;
            wv.value.hasValue = UA_FALSE;
            UA_Server_write(server, &wv);
            continue;
        }

        /* Skip if no value provided (null/missing) and quality is not bad */
        if (!value_item || cJSON_IsNull(value_item)) continue;

        /* Create the value variant based on JSON type */
        UA_Variant value;
        UA_Variant_init(&value);

        if (cJSON_IsBool(value_item)) {
            UA_Boolean val = cJSON_IsTrue(value_item) ? UA_TRUE : UA_FALSE;
            UA_Variant_setScalarCopy(&value, &val, &UA_TYPES[UA_TYPES_BOOLEAN]);
        } else if (cJSON_IsNumber(value_item)) {
            /* Default to Double for numeric values */
            UA_Double val = cJSON_GetNumberValue(value_item);
            UA_Variant_setScalarCopy(&value, &val, &UA_TYPES[UA_TYPES_DOUBLE]);
        } else if (cJSON_IsString(value_item)) {
            const char *str = cJSON_GetStringValue(value_item);
            UA_String val = UA_STRING((char *)(str ? str : ""));
            UA_Variant_setScalarCopy(&value, &val, &UA_TYPES[UA_TYPES_STRING]);
        } else {
            continue;
        }

        /* Write value with Good status */
        UA_WriteValue wv;
        UA_WriteValue_init(&wv);
        wv.nodeId = nodeId;
        wv.attributeId = UA_ATTRIBUTEID_VALUE;
        wv.value.hasValue = UA_TRUE;
        wv.value.value = value;
        wv.value.hasStatus = UA_TRUE;
        wv.value.status = UA_STATUSCODE_GOOD;

        UA_StatusCode writeStatus = UA_Server_write(server, &wv);
        if (writeStatus != UA_STATUSCODE_GOOD) {
            LOG_WARN("Value write failed for '%s': %s",
                     node_id_str, UA_StatusCode_name(writeStatus));
        }
        UA_Variant_clear(&value);
    }

    cJSON_Delete(root);
}

/* ─── Windows Stdin Reader Thread ──────────────────────────────────────────── */

#ifdef _WIN32
static unsigned __stdcall win32_stdin_reader(void *arg) {
    RuntimeContext *ctx = (RuntimeContext *)arg;
    HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
    if (hStdin == INVALID_HANDLE_VALUE) {
        LOG_WARN("stdin handle invalid, value updates disabled");
        return 0;
    }

    char line_buf[65536];
    size_t line_len = 0;

    while (InterlockedCompareExchange(&ctx->stdin_running, 1, 1)) {
        DWORD bytesRead = 0;
        char chunk[4096];
        BOOL ok = ReadFile(hStdin, chunk, sizeof(chunk), &bytesRead, NULL);
        if (!ok || bytesRead == 0) {
            /* stdin closed or error — exit thread */
            break;
        }

        /* Append to line buffer and extract complete lines */
        for (DWORD i = 0; i < bytesRead; i++) {
            if (chunk[i] == '\n') {
                line_buf[line_len] = '\0';
                if (line_len > 0) {
                    /* Enqueue the line */
                    char *copy = _strdup(line_buf);
                    if (copy) {
                        EnterCriticalSection(&ctx->stdin_cs);
                        LONG next_tail = (ctx->stdin_queue_tail + 1) % STDIN_QUEUE_SIZE;
                        if (next_tail != ctx->stdin_queue_head) {
                            ctx->stdin_queue[ctx->stdin_queue_tail] = copy;
                            ctx->stdin_queue_tail = next_tail;
                        } else {
                            free(copy); /* queue full, drop */
                        }
                        LeaveCriticalSection(&ctx->stdin_cs);
                    }
                }
                line_len = 0;
            } else if (chunk[i] != '\r') {
                if (line_len < sizeof(line_buf) - 1) {
                    line_buf[line_len++] = chunk[i];
                }
            }
        }
    }
    return 0;
}
#endif

/* ─── Public Interface ─────────────────────────────────────────────────────── */

void ipc_init(RuntimeContext *ctx) {
#ifdef _WIN32
    InitializeCriticalSection(&ctx->stdin_cs);
    ctx->stdin_running = 1;
    ctx->stdin_queue_head = 0;
    ctx->stdin_queue_tail = 0;
    ctx->stdin_thread = (HANDLE)_beginthreadex(NULL, 0, win32_stdin_reader, ctx, 0, NULL);
    if (!ctx->stdin_thread) {
        LOG_WARN("Failed to start stdin reader thread");
    } else {
        LOG_INFO("Stdin reader thread started (value updates via pipe)");
    }
#else
    /* POSIX: set stdin to non-blocking */
    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);
#endif
}

void ipc_process(RuntimeContext *ctx) {
#ifdef _WIN32
    /* Dequeue and process all pending lines */
    EnterCriticalSection(&ctx->stdin_cs);
    while (ctx->stdin_queue_head != ctx->stdin_queue_tail) {
        char *line = ctx->stdin_queue[ctx->stdin_queue_head];
        ctx->stdin_queue_head = (ctx->stdin_queue_head + 1) % STDIN_QUEUE_SIZE;
        LeaveCriticalSection(&ctx->stdin_cs);

        if (line) {
            apply_value_update(ctx->server, line);
            free(line);
        }

        EnterCriticalSection(&ctx->stdin_cs);
    }
    LeaveCriticalSection(&ctx->stdin_cs);
#else
    /* POSIX: non-blocking read from stdin */
    size_t space = sizeof(ctx->stdin_buffer) - ctx->stdin_buffer_len - 1;
    if (space == 0) {
        ctx->stdin_buffer_len = 0;
        space = sizeof(ctx->stdin_buffer) - 1;
    }

    ssize_t bytesRead = read(STDIN_FILENO, ctx->stdin_buffer + ctx->stdin_buffer_len, space);
    if (bytesRead <= 0) return;

    ctx->stdin_buffer_len += (size_t)bytesRead;
    ctx->stdin_buffer[ctx->stdin_buffer_len] = '\0';

    /* Process complete lines (newline-delimited JSON) */
    char *line_start = ctx->stdin_buffer;
    char *newline;
    while ((newline = strchr(line_start, '\n')) != NULL) {
        *newline = '\0';
        if (newline > line_start) {
            apply_value_update(ctx->server, line_start);
        }
        line_start = newline + 1;
    }

    /* Move remaining partial line to the beginning of the buffer */
    size_t remaining = ctx->stdin_buffer_len - (size_t)(line_start - ctx->stdin_buffer);
    if (remaining > 0 && line_start != ctx->stdin_buffer) {
        memmove(ctx->stdin_buffer, line_start, remaining);
    }
    ctx->stdin_buffer_len = remaining;
    ctx->stdin_buffer[ctx->stdin_buffer_len] = '\0';
#endif
}

void ipc_shutdown(RuntimeContext *ctx) {
#ifdef _WIN32
    /* Signal the stdin reader thread to stop */
    InterlockedExchange(&ctx->stdin_running, 0);
    if (ctx->stdin_thread) {
        /* Cancel the blocking ReadFile by closing stdin */
        CloseHandle(GetStdHandle(STD_INPUT_HANDLE));
        WaitForSingleObject(ctx->stdin_thread, 2000);
        CloseHandle(ctx->stdin_thread);
        ctx->stdin_thread = NULL;
    }
    /* Free any remaining queued lines */
    EnterCriticalSection(&ctx->stdin_cs);
    while (ctx->stdin_queue_head != ctx->stdin_queue_tail) {
        char *line = ctx->stdin_queue[ctx->stdin_queue_head];
        ctx->stdin_queue_head = (ctx->stdin_queue_head + 1) % STDIN_QUEUE_SIZE;
        if (line) free(line);
    }
    LeaveCriticalSection(&ctx->stdin_cs);
    DeleteCriticalSection(&ctx->stdin_cs);
#else
    /* POSIX: nothing to clean up */
    (void)ctx;
#endif
}
