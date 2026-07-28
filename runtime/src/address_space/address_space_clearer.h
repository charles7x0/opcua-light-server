#ifndef ADDRESS_SPACE_CLEARER_H
#define ADDRESS_SPACE_CLEARER_H

#include <open62541/server.h>

/* Recursively delete all custom nodes prior to reload. */
void address_space_clear(UA_Server *server, const char *config_path);

#endif /* ADDRESS_SPACE_CLEARER_H */
