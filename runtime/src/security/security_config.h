#ifndef SECURITY_CONFIG_H
#define SECURITY_CONFIG_H

#include <cJSON.h>
#include "runtime_context.h"

/* Configure security on the server. Returns 0 on success, -1 on error. */
int security_configure(RuntimeContext *ctx, cJSON *security_json);

#endif /* SECURITY_CONFIG_H */
