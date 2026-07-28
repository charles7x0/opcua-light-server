#ifndef STATUS_WRITER_H
#define STATUS_WRITER_H

#include "runtime_context.h"

/**
 * Write status.json if session state has changed since last write.
 *
 * Builds a JSON representation of connected clients and session details,
 * compares it with the previously written JSON string (ctx->last_status_json),
 * and writes to disk only if the content differs or it's the first invocation.
 *
 * On successful write, updates ctx->last_status_json with the new JSON string.
 * Skips silently if ctx->status_path is empty.
 * Logs a warning if the file cannot be opened for writing.
 */
void status_write_if_changed(RuntimeContext *ctx);

#endif /* STATUS_WRITER_H */
