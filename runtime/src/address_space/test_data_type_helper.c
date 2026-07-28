/**
 * Test helper program for validating data type table lookup via subprocess invocation.
 *
 * Usage: test_data_type_helper <type_name>
 *   type_name: The OPC UA data type name to look up (e.g., "Boolean", "Int32")
 *
 * Output: JSON on stdout: {"ns0_id":<number>}
 *   Returns the matching UA_NS0ID_* value for known types,
 *   or UA_NS0ID_DOUBLE (11) as default for unknown types.
 *
 * Exit: 0 on success, 1 on missing argument.
 */
#include <stdio.h>
#include <string.h>

/* Define open62541 NS0ID constants locally (they are just integers) */
#define UA_NS0ID_BOOLEAN    1
#define UA_NS0ID_INT16      4
#define UA_NS0ID_INT32      6
#define UA_NS0ID_INT64      8
#define UA_NS0ID_UINT16     5
#define UA_NS0ID_UINT32     7
#define UA_NS0ID_UINT64     9
#define UA_NS0ID_FLOAT      10
#define UA_NS0ID_DOUBLE     11
#define UA_NS0ID_STRING     12
#define UA_NS0ID_DATETIME   13
#define UA_NS0ID_BYTESTRING 15

/* Define UA_TYPES_* constants (needed by data_type_table.h) */
#define UA_TYPES_BOOLEAN    0
#define UA_TYPES_INT16      2
#define UA_TYPES_INT32      4
#define UA_TYPES_INT64      6
#define UA_TYPES_UINT16     3
#define UA_TYPES_UINT32     5
#define UA_TYPES_UINT64     7
#define UA_TYPES_FLOAT      8
#define UA_TYPES_DOUBLE     9
#define UA_TYPES_STRING     11
#define UA_TYPES_DATETIME   12
#define UA_TYPES_BYTESTRING 14

/* Provide UA_UInt32 and size_t types needed by the table header */
typedef unsigned int UA_UInt32;

/* Inline the data type table structure and data directly
 * (avoids needing the open62541 server.h include from data_type_table.h) */
typedef struct {
    const char *name;
    UA_UInt32 ns0_id;
    size_t ua_types_index;
} DataTypeEntry;

static const DataTypeEntry DATA_TYPE_TABLE[] = {
    {"Boolean",    UA_NS0ID_BOOLEAN,    UA_TYPES_BOOLEAN},
    {"Int16",      UA_NS0ID_INT16,      UA_TYPES_INT16},
    {"Int32",      UA_NS0ID_INT32,      UA_TYPES_INT32},
    {"Int64",      UA_NS0ID_INT64,      UA_TYPES_INT64},
    {"UInt16",     UA_NS0ID_UINT16,     UA_TYPES_UINT16},
    {"UInt32",     UA_NS0ID_UINT32,     UA_TYPES_UINT32},
    {"UInt64",     UA_NS0ID_UINT64,     UA_TYPES_UINT64},
    {"Float",      UA_NS0ID_FLOAT,      UA_TYPES_FLOAT},
    {"Double",     UA_NS0ID_DOUBLE,     UA_TYPES_DOUBLE},
    {"String",     UA_NS0ID_STRING,     UA_TYPES_STRING},
    {"DateTime",   UA_NS0ID_DATETIME,   UA_TYPES_DATETIME},
    {"ByteString", UA_NS0ID_BYTESTRING, UA_TYPES_BYTESTRING},
};

#define DATA_TYPE_TABLE_SIZE (sizeof(DATA_TYPE_TABLE) / sizeof(DATA_TYPE_TABLE[0]))

/**
 * Linear search over the data type table.
 * Returns the ns0_id for the matching type name, or UA_NS0ID_DOUBLE as default.
 */
static UA_UInt32 get_data_type_id(const char *type_str) {
    if (type_str == NULL) {
        return UA_NS0ID_DOUBLE;
    }
    for (size_t i = 0; i < DATA_TYPE_TABLE_SIZE; i++) {
        if (strcmp(DATA_TYPE_TABLE[i].name, type_str) == 0) {
            return DATA_TYPE_TABLE[i].ns0_id;
        }
    }
    return UA_NS0ID_DOUBLE;
}

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fprintf(stderr, "Usage: test_data_type_helper <type_name>\n");
        return 1;
    }

    UA_UInt32 ns0_id = get_data_type_id(argv[1]);
    printf("{\"ns0_id\":%u}\n", ns0_id);
    fflush(stdout);

    return 0;
}
