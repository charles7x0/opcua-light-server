#ifndef IPC_PROCESSOR_H
#define IPC_PROCESSOR_H

#include "runtime_context.h"

/* Initialize IPC (start stdin reader thread on Windows, set non-blocking on POSIX). */
void ipc_init(RuntimeContext *ctx);

/* Process pending stdin lines and apply value updates. Called from repeated callback. */
void ipc_process(RuntimeContext *ctx);

/* Cleanup IPC resources (stop threads on Windows). */
void ipc_shutdown(RuntimeContext *ctx);

#endif /* IPC_PROCESSOR_H */
