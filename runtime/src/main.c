/**
 * OPC UA Light Server Runtime — Entry Point
 *
 * Argument parsing, signal setup, and server lifecycle orchestration.
 * All domain logic lives in server.c and its sub-modules.
 *
 * Usage: opcua-runtime <config-file-path>
 *
 * Signals:
 *   SIGUSR1       - Reload configuration (Linux/macOS)
 *   SIGTERM/SIGINT - Graceful shutdown
 *   Ctrl+C        - Graceful shutdown (Windows)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>

#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

#include "server.h"
#include "util/logging.h"
#include "runtime_context.h"

/* ─── Signal Flags (file-scope globals) ────────────────────────────────────── */

volatile sig_atomic_t g_running = 1;
volatile sig_atomic_t g_reload_requested = 0;

/* ─── Signal Handlers ──────────────────────────────────────────────────────── */

#ifndef _WIN32
static void signal_reload_handler(int sig) {
    (void)sig;
    g_reload_requested = 1;
}

static void signal_shutdown_handler(int sig) {
    (void)sig;
    g_running = 0;
}
#else
static BOOL WINAPI win32_ctrl_handler(DWORD ctrl_type) {
    switch (ctrl_type) {
        case CTRL_C_EVENT:
        case CTRL_BREAK_EVENT:
        case CTRL_CLOSE_EVENT:
            g_running = 0;
            return TRUE;
        default:
            return FALSE;
    }
}
#endif

/* ─── Entry Point ──────────────────────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <config-file-path>\n", argv[0]);
        return EXIT_FAILURE;
    }

    /* Allocate and zero-initialize RuntimeContext on the stack */
    RuntimeContext ctx;
    memset(&ctx, 0, sizeof(ctx));

    /* Populate config_path from argument */
    strncpy(ctx.config_path, argv[1], sizeof(ctx.config_path) - 1);
    ctx.config_path[sizeof(ctx.config_path) - 1] = '\0';

    /* Derive status_path: replace filename with "status.json" */
    strncpy(ctx.status_path, ctx.config_path, sizeof(ctx.status_path) - 1);
    ctx.status_path[sizeof(ctx.status_path) - 1] = '\0';
    {
        char *last_sep = strrchr(ctx.status_path, '/');
        char *last_sep_win = strrchr(ctx.status_path, '\\');
        if (last_sep_win && (!last_sep || last_sep_win > last_sep)) {
            last_sep = last_sep_win;
        }
        if (last_sep) {
            strcpy(last_sep + 1, "status.json");
        } else {
            strcpy(ctx.status_path, "status.json");
        }
    }

    LOG_INFO("OPC UA Light Server Runtime");
    LOG_INFO("Config file: %s", ctx.config_path);
    LOG_INFO("Status file: %s", ctx.status_path);

    /* Create and configure the server */
    if (server_create(&ctx) != 0) {
        LOG_ERROR("Server creation failed");
        return EXIT_FAILURE;
    }

    /* Register signal handlers */
#ifndef _WIN32
    struct sigaction sa_reload;
    memset(&sa_reload, 0, sizeof(sa_reload));
    sa_reload.sa_handler = signal_reload_handler;
    sigemptyset(&sa_reload.sa_mask);
    sa_reload.sa_flags = 0;
    sigaction(SIGUSR1, &sa_reload, NULL);

    struct sigaction sa_shutdown;
    memset(&sa_shutdown, 0, sizeof(sa_shutdown));
    sa_shutdown.sa_handler = signal_shutdown_handler;
    sigemptyset(&sa_shutdown.sa_mask);
    sa_shutdown.sa_flags = 0;
    sigaction(SIGTERM, &sa_shutdown, NULL);
    sigaction(SIGINT, &sa_shutdown, NULL);

    LOG_INFO("Signal handlers registered (SIGUSR1=reload, SIGTERM/SIGINT=shutdown)");
#else
    SetConsoleCtrlHandler(win32_ctrl_handler, TRUE);
    LOG_INFO("Windows console handler registered (Ctrl+C=shutdown)");
#endif

    /* Run the server (blocks until g_running becomes false) */
    LOG_INFO("Starting OPC UA server...");
    UA_StatusCode status = server_run(&ctx);

    /* Shutdown and cleanup */
    server_shutdown(&ctx);

    if (status != UA_STATUSCODE_GOOD) {
        LOG_ERROR("Server exited with error: %s", UA_StatusCode_name(status));
        return EXIT_FAILURE;
    }

    LOG_INFO("Server shutdown complete");
    return EXIT_SUCCESS;
}
