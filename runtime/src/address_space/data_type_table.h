#ifndef DATA_TYPE_TABLE_H
#define DATA_TYPE_TABLE_H

#include <open62541/server.h>

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

#endif /* DATA_TYPE_TABLE_H */
