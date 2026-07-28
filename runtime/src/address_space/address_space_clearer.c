#include "address_space_clearer.h"

#include <string.h>
#include <cJSON.h>

#include "util/logging.h"
#include "util/file_io.h"
#include "util/node_id_parser.h"

/* ─── Internal: Recursive post-order deletion of object nodes ──────────────── */

static void delete_object_nodes_recursive(UA_Server *server, cJSON *nodes_array, UA_UInt16 ns_index) {
    if (!cJSON_IsArray(nodes_array)) return;

    cJSON *obj_node = NULL;
    cJSON_ArrayForEach(obj_node, nodes_array) {
        cJSON *children = cJSON_GetObjectItemCaseSensitive(obj_node, "children");
        cJSON *path_item = cJSON_GetObjectItemCaseSensitive(obj_node, "path");
        const char *path = cJSON_GetStringValue(path_item);

        /* Post-order: recurse into children first (deepest leaves deleted first) */
        if (cJSON_IsArray(children)) {
            delete_object_nodes_recursive(server, children, ns_index);
        }

        /* Then delete this node */
        if (path) {
            UA_NodeId objId = UA_NODEID_STRING(ns_index, (char *)path);
            UA_Server_deleteNode(server, objId, UA_TRUE);
        }
    }
}

/* ─── Public API ───────────────────────────────────────────────────────────── */

void address_space_clear(UA_Server *server, const char *config_path) {
    LOG_INFO("Clearing custom address space nodes for reload...");

    char *json_str = file_read_text(config_path);
    if (!json_str) {
        LOG_ERROR("Failed to read config file for address space clearing: %s", config_path);
        return;
    }

    cJSON *config = cJSON_Parse(json_str);
    free(json_str);
    if (!config) {
        LOG_ERROR("Failed to parse config JSON for address space clearing");
        return;
    }

    cJSON *namespaces = cJSON_GetObjectItemCaseSensitive(config, "namespaces");
    if (!cJSON_IsArray(namespaces)) {
        cJSON_Delete(config);
        return;
    }

    cJSON *ns_item = NULL;
    cJSON_ArrayForEach(ns_item, namespaces) {
        cJSON *name_item = cJSON_GetObjectItemCaseSensitive(ns_item, "name");
        cJSON *uri_item = cJSON_GetObjectItemCaseSensitive(ns_item, "uri");
        cJSON *nodes_item = cJSON_GetObjectItemCaseSensitive(ns_item, "nodes");
        cJSON *object_nodes_item = cJSON_GetObjectItemCaseSensitive(ns_item, "objectNodes");

        const char *ns_uri = cJSON_GetStringValue(uri_item);
        const char *ns_name = cJSON_GetStringValue(name_item);
        if (!ns_uri) continue;

        /* Find the namespace index */
        size_t found_index = 0;
        UA_String uri_str = UA_STRING((char *)ns_uri);
        UA_StatusCode ns_status = UA_Server_getNamespaceByName(server, uri_str, &found_index);
        if (ns_status != UA_STATUSCODE_GOOD) continue;
        UA_UInt16 ns_index = (UA_UInt16)found_index;

        /* Phase 1: Delete variable nodes first */
        if (cJSON_IsArray(nodes_item)) {
            cJSON *node_item = NULL;
            cJSON_ArrayForEach(node_item, nodes_item) {
                cJSON *nid = cJSON_GetObjectItemCaseSensitive(node_item, "nodeId");
                const char *nid_str = cJSON_GetStringValue(nid);
                if (!nid_str) continue;

                UA_NodeId nodeId = UA_NODEID_NULL;
                if (parse_node_id_string(nid_str, &nodeId) == 0) {
                    UA_Server_deleteNode(server, nodeId, UA_TRUE);
                }
            }
        }

        /* Phase 2: Delete object nodes in post-order (deepest leaves first) */
        if (cJSON_IsArray(object_nodes_item)) {
            delete_object_nodes_recursive(server, object_nodes_item, ns_index);
        }

        /* Phase 3: Delete the namespace root object node */
        if (ns_name) {
            UA_NodeId nsRootId = UA_NODEID_STRING(ns_index, (char *)ns_name);
            UA_Server_deleteNode(server, nsRootId, UA_TRUE);
        }
    }

    cJSON_Delete(config);
    LOG_INFO("Address space cleared.");
}
