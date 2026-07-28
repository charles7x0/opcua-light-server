#ifndef SERVER_H
#define SERVER_H

#include "runtime_context.h"
#include <open62541/server.h>

/* Create and configure the server. Returns 0 on success, -1 on error. */
int server_create(RuntimeContext *ctx);

/* Run the server loop (blocks until g_running is false). Returns UA_StatusCode. */
UA_StatusCode server_run(RuntimeContext *ctx);

/* Shutdown and delete the server. */
void server_shutdown(RuntimeContext *ctx);

#endif /* SERVER_H */
