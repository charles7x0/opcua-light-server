#ifndef NODE_ID_PARSER_H
#define NODE_ID_PARSER_H

#include <open62541/server.h>

/* Parse "ns=X;s=StringId" into a UA_NodeId. Returns 0 on success, -1 on failure. */
int parse_node_id_string(const char *str, UA_NodeId *out_id);

#endif /* NODE_ID_PARSER_H */
