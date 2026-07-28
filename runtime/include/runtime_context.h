#ifndef RUNTIME_CONTEXT_H
#define RUNTIME_CONTEXT_H

#include <open62541/server.h>
#include "security/tofu_verifier.h"

#ifdef _WIN32
#include <windows.h>
#endif

typedef struct {
    /* OPC UA server handle */
    UA_Server *server;

    /* File paths */
    char config_path[4096];
    char status_path[4096];

    /* TOFU verifier state */
    TofuVerifierContext tofu_ctx;

    /* Stdin IPC buffer */
    char stdin_buffer[65536];
    size_t stdin_buffer_len;

    /* Status change detection */
    char *last_status_json;  /* heap-allocated, NULL on first call */

#ifdef _WIN32
    /* Windows threading handles */
    HANDLE stdin_thread;
    HANDLE pipe_thread;
    volatile LONG stdin_running;
    volatile LONG pipe_running;
    CRITICAL_SECTION stdin_cs;
    char *stdin_queue[256];
    volatile LONG stdin_queue_head;
    volatile LONG stdin_queue_tail;
#endif
} RuntimeContext;

#endif /* RUNTIME_CONTEXT_H */
