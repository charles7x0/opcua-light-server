#ifndef ADDRESS_SPACE_BUILDER_H
#define ADDRESS_SPACE_BUILDER_H

#include <open62541/server.h>
#include <cJSON.h>

/* Build the OPC UA address space from parsed config. Returns 0 on success, -1 on error. */
int address_space_build(UA_Server *server, cJSON *config);

#endif /* ADDRESS_SPACE_BUILDER_H */
