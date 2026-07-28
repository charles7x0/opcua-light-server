#include "address_space_builder.h"
#include "data_type_table.h"
#include "util/logging.h"
#include "util/node_id_parser.h"

#include <string.h>

/* ─── Data Type Lookup (linear search over DATA_TYPE_TABLE) ────────────────── */

static UA_UInt32 get_data_type_id(const char *type_str) {
    if (!type_str) return UA_NS0ID_DOUBLE;

    for (size_t i = 0; i < DATA_TYPE_TABLE_SIZE; i++) {
        if (strcmp(type_str, DATA_TYPE_TABLE[i].name) == 0) {
            return DATA_TYPE_TABLE[i].ns0_id;
        }
    }

    /* Default to Double for unknown types */
    LOG_WARN("Unknown data type '%s', defaulting to Double", type_str);
    return UA_NS0ID_DOUBLE;
}

/* ─── Initial Value Setting (table-driven) ─────────────────────────────────── */

static UA_Variant create_initial_value(const char *data_type, cJSON *value_json) {
    UA_Variant variant;
    UA_Variant_init(&variant);

    /* Find the type index from the table */
    size_t type_index = UA_TYPES_DOUBLE; /* default */
    for (size_t i = 0; i < DATA_TYPE_TABLE_SIZE; i++) {
        if (strcmp(data_type, DATA_TYPE_TABLE[i].name) == 0) {
            type_index = DATA_TYPE_TABLE[i].ua_types_index;
            break;
        }
    }

    if (!value_json || cJSON_IsNull(value_json)) {
        /* Set a default zero/empty value based on type */
        if (strcmp(data_type, "Boolean") == 0) {
            UA_Boolean val = UA_FALSE;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_BOOLEAN]);
        } else if (strcmp(data_type, "String") == 0) {
            UA_String val = UA_STRING("");
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_STRING]);
        } else if (type_index == UA_TYPES_INT16) {
            UA_Int16 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
        } else if (type_index == UA_TYPES_INT32) {
            UA_Int32 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
        } else if (type_index == UA_TYPES_INT64) {
            UA_Int64 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
        } else if (type_index == UA_TYPES_UINT16) {
            UA_UInt16 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
        } else if (type_index == UA_TYPES_UINT32) {
            UA_UInt32 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
        } else if (type_index == UA_TYPES_UINT64) {
            UA_UInt64 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
        } else if (type_index == UA_TYPES_FLOAT) {
            UA_Float val = 0.0f;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
        } else {
            /* Default: Double (also handles DateTime, ByteString as numeric) */
            UA_Double val = 0.0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_DOUBLE]);
        }
        return variant;
    }

    /* Set value from JSON */
    if (strcmp(data_type, "Boolean") == 0) {
        UA_Boolean val = cJSON_IsTrue(value_json) ? UA_TRUE : UA_FALSE;
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_BOOLEAN]);
    } else if (strcmp(data_type, "String") == 0) {
        const char *str = cJSON_GetStringValue(value_json);
        UA_String val = UA_STRING((char *)(str ? str : ""));
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_STRING]);
    } else if (type_index == UA_TYPES_FLOAT) {
        UA_Float val = (UA_Float)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
    } else if (type_index == UA_TYPES_INT16) {
        UA_Int16 val = (UA_Int16)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
    } else if (type_index == UA_TYPES_INT32) {
        UA_Int32 val = (UA_Int32)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
    } else if (type_index == UA_TYPES_INT64) {
        UA_Int64 val = (UA_Int64)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
    } else if (type_index == UA_TYPES_UINT16) {
        UA_UInt16 val = (UA_UInt16)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
    } else if (type_index == UA_TYPES_UINT32) {
        UA_UInt32 val = (UA_UInt32)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
    } else if (type_index == UA_TYPES_UINT64) {
        UA_UInt64 val = (UA_UInt64)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[type_index]);
    } else {
        /* Default: Double (also handles DateTime, ByteString as numeric) */
        UA_Double val = cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_DOUBLE]);
    }

    return variant;
}

/* ─── Object Node Creation ─────────────────────────────────────────────────── */

static UA_NodeId create_object_node(UA_Server *server, UA_NodeId parent_id,
                                    UA_UInt16 ns_index, const char *name) {
    UA_NodeId object_node_id = UA_NODEID_STRING(ns_index, (char *)name);
    UA_ObjectAttributes attr = UA_ObjectAttributes_default;
    attr.displayName = UA_LOCALIZEDTEXT("en-US", (char *)name);
    attr.description = UA_LOCALIZEDTEXT("en-US", (char *)name);

    UA_StatusCode status = UA_Server_addObjectNode(
        server,
        object_node_id,
        parent_id,
        UA_NODEID_NUMERIC(0, UA_NS0ID_HASCOMPONENT),
        UA_QUALIFIEDNAME(ns_index, (char *)name),
        UA_NODEID_NUMERIC(0, UA_NS0ID_BASEOBJECTTYPE),
        attr,
        NULL,
        NULL
    );

    if (status != UA_STATUSCODE_GOOD) {
        LOG_WARN("Failed to create object node '%s': %s", name, UA_StatusCode_name(status));
    }

    return object_node_id;
}

/* ─── Object Node Creation (Recursive) ─────────────────────────────────────── */

static void create_object_nodes_recursive(UA_Server *server, cJSON *object_nodes,
                                          UA_NodeId parent_id, UA_UInt16 ns_index) {
    cJSON *obj_node = NULL;
    cJSON_ArrayForEach(obj_node, object_nodes) {
        cJSON *name_item = cJSON_GetObjectItemCaseSensitive(obj_node, "name");
        cJSON *path_item = cJSON_GetObjectItemCaseSensitive(obj_node, "path");
        cJSON *children = cJSON_GetObjectItemCaseSensitive(obj_node, "children");

        const char *node_name = cJSON_GetStringValue(name_item);
        const char *node_path = cJSON_GetStringValue(path_item);

        if (!node_name) continue;

        /* Use path as the node ID if available, otherwise use name */
        const char *node_id_str = node_path ? node_path : node_name;
        UA_NodeId obj_node_id = UA_NODEID_STRING(ns_index, (char *)node_id_str);

        UA_ObjectAttributes attr = UA_ObjectAttributes_default;
        attr.displayName = UA_LOCALIZEDTEXT("en-US", (char *)node_name);
        attr.description = UA_LOCALIZEDTEXT("en-US", (char *)node_name);

        UA_StatusCode status = UA_Server_addObjectNode(
            server,
            obj_node_id,
            parent_id,
            UA_NODEID_NUMERIC(0, UA_NS0ID_HASCOMPONENT),
            UA_QUALIFIEDNAME(ns_index, (char *)node_name),
            UA_NODEID_NUMERIC(0, UA_NS0ID_BASEOBJECTTYPE),
            attr,
            NULL,
            NULL
        );

        if (status != UA_STATUSCODE_GOOD) {
            LOG_WARN("Failed to create object node '%s': %s",
                     node_name, UA_StatusCode_name(status));
        }

        /* Recursively create child object nodes */
        if (cJSON_IsArray(children) && cJSON_GetArraySize(children) > 0) {
            create_object_nodes_recursive(server, children, obj_node_id, ns_index);
        }
    }
}

/* ─── Variable Node Creation ───────────────────────────────────────────────── */

static void create_variable_node(UA_Server *server, cJSON *node_json,
                                 UA_UInt16 ns_index) {
    cJSON *name_item = cJSON_GetObjectItemCaseSensitive(node_json, "name");
    cJSON *node_id_item = cJSON_GetObjectItemCaseSensitive(node_json, "nodeId");
    cJSON *data_type_item = cJSON_GetObjectItemCaseSensitive(node_json, "dataType");
    cJSON *parent_path_item = cJSON_GetObjectItemCaseSensitive(node_json, "parentPath");
    cJSON *initial_value_item = cJSON_GetObjectItemCaseSensitive(node_json, "initialValue");

    const char *name = cJSON_GetStringValue(name_item);
    const char *node_id_str = cJSON_GetStringValue(node_id_item);
    const char *data_type = cJSON_GetStringValue(data_type_item);
    const char *parent_path = cJSON_GetStringValue(parent_path_item);

    if (!name || !data_type) {
        LOG_WARN("Skipping node with missing name or dataType");
        return;
    }

    /* Determine parent node: object node or Objects folder */
    UA_NodeId parent_id;
    if (parent_path && strlen(parent_path) > 0) {
        parent_id = UA_NODEID_STRING(ns_index, (char *)parent_path);
    } else {
        parent_id = UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER);
    }

    /* Determine the node ID */
    UA_NodeId variable_node_id;
    if (node_id_str && strlen(node_id_str) > 0) {
        /* Use parse_node_id_string for validation of the "ns=X;s=StringId" format.
         * We use the registered ns_index (not the one from the string) because the
         * config's namespace registration determines the actual namespace index. */
        UA_NodeId parsed_id;
        if (parse_node_id_string(node_id_str, &parsed_id) == 0) {
            /* Valid format — extract the string identifier (after ";s=") */
            const char *semi = strstr(node_id_str, ";s=");
            variable_node_id = UA_NODEID_STRING(ns_index, (char *)(semi + 3));
        } else {
            /* Not in ns=X;s=Y format — use the raw string as-is with registered ns_index */
            variable_node_id = UA_NODEID_STRING(ns_index, (char *)node_id_str);
        }
    } else {
        variable_node_id = UA_NODEID_STRING(ns_index, (char *)name);
    }

    /* Set up variable attributes */
    UA_VariableAttributes attr = UA_VariableAttributes_default;
    attr.displayName = UA_LOCALIZEDTEXT("en-US", (char *)name);
    attr.description = UA_LOCALIZEDTEXT("en-US", (char *)name);
    attr.accessLevel = UA_ACCESSLEVELMASK_READ | UA_ACCESSLEVELMASK_WRITE;
    attr.dataType = UA_NODEID_NUMERIC(0, get_data_type_id(data_type));

    /* Set initial value */
    attr.value = create_initial_value(data_type, initial_value_item);

    UA_StatusCode status = UA_Server_addVariableNode(
        server,
        variable_node_id,
        parent_id,
        UA_NODEID_NUMERIC(0, UA_NS0ID_HASCOMPONENT),
        UA_QUALIFIEDNAME(ns_index, (char *)name),
        UA_NODEID_NUMERIC(0, UA_NS0ID_BASEDATAVARIABLETYPE),
        attr,
        NULL,
        NULL
    );

    if (status != UA_STATUSCODE_GOOD) {
        LOG_WARN("Failed to create node '%s': %s", name, UA_StatusCode_name(status));
    }

    /* Clean up the variant data if it was allocated */
    UA_Variant_clear(&attr.value);
}

/* ─── Address Space Building ───────────────────────────────────────────────── */

int address_space_build(UA_Server *server, cJSON *config) {
    cJSON *namespaces = cJSON_GetObjectItemCaseSensitive(config, "namespaces");
    if (!cJSON_IsArray(namespaces)) {
        LOG_ERROR("Config missing 'namespaces' array");
        return -1;
    }

    cJSON *ns_item = NULL;
    cJSON_ArrayForEach(ns_item, namespaces) {
        cJSON *name_item = cJSON_GetObjectItemCaseSensitive(ns_item, "name");
        cJSON *uri_item = cJSON_GetObjectItemCaseSensitive(ns_item, "uri");
        cJSON *object_nodes_item = cJSON_GetObjectItemCaseSensitive(ns_item, "objectNodes");
        cJSON *nodes_item = cJSON_GetObjectItemCaseSensitive(ns_item, "nodes");

        const char *ns_name = cJSON_GetStringValue(name_item);
        const char *ns_uri = cJSON_GetStringValue(uri_item);

        if (!ns_uri) {
            LOG_WARN("Namespace missing 'uri', skipping");
            continue;
        }

        /* Register the namespace and get its index */
        UA_UInt16 ns_index = UA_Server_addNamespace(server, ns_uri);
        LOG_INFO("Registered namespace '%s' (uri: %s) at index %u",
                 ns_name ? ns_name : "(unnamed)", ns_uri, ns_index);

        /* Create a root object node for this namespace under Objects */
        UA_NodeId ns_root_id = UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER);
        if (ns_name) {
            ns_root_id = create_object_node(server,
                UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER),
                ns_index, ns_name);
        }

        /* Create object nodes recursively */
        if (cJSON_IsArray(object_nodes_item)) {
            create_object_nodes_recursive(server, object_nodes_item, ns_root_id, ns_index);
        }

        /* Create variable nodes */
        if (cJSON_IsArray(nodes_item)) {
            cJSON *node_item = NULL;
            cJSON_ArrayForEach(node_item, nodes_item) {
                create_variable_node(server, node_item, ns_index);
            }
        }
    }

    return 0;
}
