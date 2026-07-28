#include "node_id_parser.h"

#include <string.h>
#include <stdlib.h>
#include <limits.h>

int parse_node_id_string(const char *str, UA_NodeId *out_id) {
    /* NULL or empty string */
    if (!str || str[0] == '\0') {
        return -1;
    }

    /* Must start with "ns=" */
    if (strncmp(str, "ns=", 3) != 0) {
        return -1;
    }

    /* Parse namespace digits after "ns=" */
    const char *p = str + 3;

    /* Must have at least one digit */
    if (*p < '0' || *p > '9') {
        return -1;
    }

    char *endptr = NULL;
    unsigned long ns_val = strtoul(p, &endptr, 10);

    /* Check for valid conversion (endptr must have advanced) */
    if (endptr == p) {
        return -1;
    }

    /* Validate namespace range [0, 65535] */
    if (ns_val > 65535) {
        return -1;
    }

    /* Find ";s=" delimiter immediately after namespace digits */
    if (strncmp(endptr, ";s=", 3) != 0) {
        return -1;
    }

    /* Extract the identifier string after ";s=" */
    const char *identifier = endptr + 3;

    /* Identifier must be non-empty */
    if (identifier[0] == '\0') {
        return -1;
    }

    /* Set the output NodeId */
    *out_id = UA_NODEID_STRING((UA_UInt16)ns_val, (char *)identifier);

    return 0;
}
