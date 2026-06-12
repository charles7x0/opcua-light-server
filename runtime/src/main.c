/**
 * OPC UA Light Server Runtime
 *
 * open62541-based OPC UA server that reads a JSON configuration file,
 * builds the address space, and serves OPC UA clients on port 4840.
 *
 * Usage: opcua-runtime <config-file-path>
 *
 * Signals:
 *   SIGUSR1 - Reload configuration from disk (Linux/macOS)
 *   SIGTERM - Graceful shutdown
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>

#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#include <process.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

#include <open62541/server.h>
#include <open62541/server_config_default.h>
#include <open62541/plugin/log_stdout.h>
#include <open62541/plugin/securitypolicy.h>

#include <cJSON.h>

#include "tofu_verifier.h"

/* ─── Global State ─────────────────────────────────────────────────────────── */

static volatile sig_atomic_t g_reload_requested = 0;
static volatile UA_Boolean g_running = UA_TRUE;
static UA_Server *g_server = NULL;
static char g_config_path[4096] = {0};
static char g_status_path[4096] = {0};
static TofuVerifierContext g_tofu_ctx;

/* ─── Status File ──────────────────────────────────────────────────────────── */

/**
 * Write the current runtime status to a JSON file.
 * The Node.js API reads this file to report connected client count.
 */
static void write_status_file(UA_Server *server) {
    if (g_status_path[0] == '\0') return;

    UA_ServerStatistics stats = UA_Server_getStatistics(server);
    int clients = (int)stats.ss.currentSessionCount;

    FILE *f = fopen(g_status_path, "w");
    if (!f) return;

    fprintf(f, "{\"connectedClients\":%d}\n", clients);
    fclose(f);
}

/* ─── Forward Declarations ─────────────────────────────────────────────────── */

static char *read_file(const char *path);
static cJSON *parse_config(const char *json_str);
static int build_address_space(UA_Server *server, cJSON *config);
static int configure_security(UA_Server *server, cJSON *security);
static void clear_address_space(UA_Server *server);
static void handle_reload(UA_Server *server);
static void process_stdin_updates(UA_Server *server);
static void apply_value_update(UA_Server *server, const char *json_line);

/* ─── Signal Handlers ──────────────────────────────────────────────────────── */

#ifndef _WIN32
static void signal_reload_handler(int sig) {
    (void)sig;
    g_reload_requested = 1;
}

static void signal_shutdown_handler(int sig) {
    (void)sig;
    g_running = UA_FALSE;
}
#else
/* Windows: Console control handler for graceful shutdown (Ctrl+C, taskkill) */
static BOOL WINAPI win32_ctrl_handler(DWORD ctrl_type) {
    switch (ctrl_type) {
        case CTRL_C_EVENT:
        case CTRL_BREAK_EVENT:
        case CTRL_CLOSE_EVENT:
            g_running = UA_FALSE;
            return TRUE;
        default:
            return FALSE;
    }
}

/* Windows: Named pipe listener thread for reload signals.
 * Creates \\.\pipe\opcua-runtime-{pid} and waits for "reload" messages. */
static HANDLE g_pipe_thread = NULL;
static volatile LONG g_pipe_running = 1;

static unsigned __stdcall win32_pipe_listener(void *arg) {
    (void)arg;
    char pipe_name[256];
    snprintf(pipe_name, sizeof(pipe_name),
             "\\\\.\\pipe\\opcua-runtime-%lu", (unsigned long)GetCurrentProcessId());

    printf("Named pipe listener started: %s\n", pipe_name);

    while (InterlockedCompareExchange(&g_pipe_running, 1, 1)) {
        HANDLE pipe = CreateNamedPipeA(
            pipe_name,
            PIPE_ACCESS_INBOUND,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
            1,       /* max instances */
            256,     /* out buffer size */
            256,     /* in buffer size */
            1000,    /* default timeout ms */
            NULL     /* security attributes */
        );

        if (pipe == INVALID_HANDLE_VALUE) {
            fprintf(stderr, "Error: Failed to create named pipe (error %lu)\n",
                    (unsigned long)GetLastError());
            Sleep(1000);
            continue;
        }

        /* Wait for a client to connect (blocking) */
        BOOL connected = ConnectNamedPipe(pipe, NULL)
                         ? TRUE
                         : (GetLastError() == ERROR_PIPE_CONNECTED);

        if (!connected || !InterlockedCompareExchange(&g_pipe_running, 1, 1)) {
            CloseHandle(pipe);
            continue;
        }

        /* Read the message */
        char buffer[256] = {0};
        DWORD bytes_read = 0;
        BOOL success = ReadFile(pipe, buffer, sizeof(buffer) - 1, &bytes_read, NULL);

        if (success && bytes_read > 0) {
            buffer[bytes_read] = '\0';
            /* Trim trailing whitespace/newlines */
            while (bytes_read > 0 &&
                   (buffer[bytes_read - 1] == '\n' ||
                    buffer[bytes_read - 1] == '\r' ||
                    buffer[bytes_read - 1] == ' ')) {
                buffer[--bytes_read] = '\0';
            }

            if (strcmp(buffer, "reload") == 0) {
                printf("Reload signal received via named pipe.\n");
                g_reload_requested = 1;
            } else {
                fprintf(stderr, "Unknown pipe command: '%s'\n", buffer);
            }
        }

        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }

    return 0;
}
#endif

/* ─── File I/O ─────────────────────────────────────────────────────────────── */

static char *read_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open file '%s'\n", path);
        return NULL;
    }

    fseek(f, 0, SEEK_END);
    long length = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (length <= 0) {
        fclose(f);
        fprintf(stderr, "Error: File '%s' is empty or unreadable\n", path);
        return NULL;
    }

    char *buffer = (char *)malloc((size_t)length + 1);
    if (!buffer) {
        fclose(f);
        fprintf(stderr, "Error: Memory allocation failed\n");
        return NULL;
    }

    size_t read_count = fread(buffer, 1, (size_t)length, f);
    fclose(f);

    buffer[read_count] = '\0';
    return buffer;
}

/**
 * Read a binary file into a UA_ByteString.
 * Unlike read_file(), this is safe for DER-encoded certificates and keys.
 */
static UA_ByteString read_file_binary(const char *path) {
    UA_ByteString data = UA_BYTESTRING_NULL;

    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "Error: Cannot open file '%s'\n", path);
        return data;
    }

    fseek(f, 0, SEEK_END);
    long length = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (length <= 0) {
        fclose(f);
        fprintf(stderr, "Error: File '%s' is empty or unreadable\n", path);
        return data;
    }

    data.length = (size_t)length;
    data.data = (UA_Byte *)UA_malloc(data.length);
    if (!data.data) {
        fclose(f);
        data.length = 0;
        fprintf(stderr, "Error: Memory allocation failed for '%s'\n", path);
        return data;
    }

    size_t read_count = fread(data.data, 1, data.length, f);
    fclose(f);

    if (read_count != data.length) {
        UA_free(data.data);
        data.data = NULL;
        data.length = 0;
        fprintf(stderr, "Error: Incomplete read of '%s'\n", path);
    }

    return data;
}

/* ─── JSON Config Parsing ──────────────────────────────────────────────────── */

static cJSON *parse_config(const char *json_str) {
    cJSON *root = cJSON_Parse(json_str);
    if (!root) {
        const char *error_ptr = cJSON_GetErrorPtr();
        if (error_ptr) {
            fprintf(stderr, "Error: JSON parse error near: %s\n", error_ptr);
        }
        return NULL;
    }

    /* Validate required top-level fields */
    cJSON *namespaces = cJSON_GetObjectItemCaseSensitive(root, "namespaces");
    if (!cJSON_IsArray(namespaces)) {
        fprintf(stderr, "Error: Config missing 'namespaces' array\n");
        cJSON_Delete(root);
        return NULL;
    }

    return root;
}

/* ─── Data Type Mapping ────────────────────────────────────────────────────── */

static UA_UInt32 get_data_type_id(const char *type_str) {
    if (!type_str) return UA_NS0ID_DOUBLE;

    if (strcmp(type_str, "Boolean") == 0) return UA_NS0ID_BOOLEAN;
    if (strcmp(type_str, "Int16") == 0)   return UA_NS0ID_INT16;
    if (strcmp(type_str, "Int32") == 0)   return UA_NS0ID_INT32;
    if (strcmp(type_str, "Int64") == 0)   return UA_NS0ID_INT64;
    if (strcmp(type_str, "UInt16") == 0)  return UA_NS0ID_UINT16;
    if (strcmp(type_str, "UInt32") == 0)  return UA_NS0ID_UINT32;
    if (strcmp(type_str, "UInt64") == 0)  return UA_NS0ID_UINT64;
    if (strcmp(type_str, "Float") == 0)   return UA_NS0ID_FLOAT;
    if (strcmp(type_str, "Double") == 0)  return UA_NS0ID_DOUBLE;
    if (strcmp(type_str, "String") == 0)  return UA_NS0ID_STRING;
    if (strcmp(type_str, "DateTime") == 0) return UA_NS0ID_DATETIME;
    if (strcmp(type_str, "ByteString") == 0) return UA_NS0ID_BYTESTRING;

    /* Default to Double for unknown types */
    fprintf(stderr, "Warning: Unknown data type '%s', defaulting to Double\n", type_str);
    return UA_NS0ID_DOUBLE;
}

/* ─── Initial Value Setting ────────────────────────────────────────────────── */

static UA_Variant create_initial_value(const char *data_type, cJSON *value_json) {
    UA_Variant variant;
    UA_Variant_init(&variant);

    if (!value_json || cJSON_IsNull(value_json)) {
        /* Set a default zero/empty value based on type */
        if (strcmp(data_type, "Boolean") == 0) {
            UA_Boolean val = UA_FALSE;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_BOOLEAN]);
        } else if (strcmp(data_type, "Int16") == 0) {
            UA_Int16 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_INT16]);
        } else if (strcmp(data_type, "Int32") == 0) {
            UA_Int32 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_INT32]);
        } else if (strcmp(data_type, "Int64") == 0) {
            UA_Int64 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_INT64]);
        } else if (strcmp(data_type, "UInt16") == 0) {
            UA_UInt16 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_UINT16]);
        } else if (strcmp(data_type, "UInt32") == 0) {
            UA_UInt32 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_UINT32]);
        } else if (strcmp(data_type, "UInt64") == 0) {
            UA_UInt64 val = 0;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_UINT64]);
        } else if (strcmp(data_type, "Float") == 0) {
            UA_Float val = 0.0f;
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_FLOAT]);
        } else if (strcmp(data_type, "String") == 0) {
            UA_String val = UA_STRING("");
            UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_STRING]);
        } else {
            /* Default: Double */
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
    } else if (strcmp(data_type, "Float") == 0) {
        UA_Float val = (UA_Float)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_FLOAT]);
    } else if (strcmp(data_type, "Int16") == 0) {
        UA_Int16 val = (UA_Int16)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_INT16]);
    } else if (strcmp(data_type, "Int32") == 0) {
        UA_Int32 val = (UA_Int32)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_INT32]);
    } else if (strcmp(data_type, "Int64") == 0) {
        UA_Int64 val = (UA_Int64)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_INT64]);
    } else if (strcmp(data_type, "UInt16") == 0) {
        UA_UInt16 val = (UA_UInt16)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_UINT16]);
    } else if (strcmp(data_type, "UInt32") == 0) {
        UA_UInt32 val = (UA_UInt32)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_UINT32]);
    } else if (strcmp(data_type, "UInt64") == 0) {
        UA_UInt64 val = (UA_UInt64)cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_UINT64]);
    } else {
        /* Default: Double (also handles DateTime, ByteString as numeric) */
        UA_Double val = cJSON_GetNumberValue(value_json);
        UA_Variant_setScalarCopy(&variant, &val, &UA_TYPES[UA_TYPES_DOUBLE]);
    }

    return variant;
}

/* ─── Object Node Creation (Recursive) ─────────────────────────────────────── */

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
        fprintf(stderr, "Warning: Failed to create object node '%s': %s\n",
                name, UA_StatusCode_name(status));
    }

    return object_node_id;
}

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
            fprintf(stderr, "Warning: Failed to create object node '%s': %s\n",
                    node_name, UA_StatusCode_name(status));
        }

        /* Recursively create child object nodes */
        if (cJSON_IsArray(children) && cJSON_GetArraySize(children) > 0) {
            create_object_nodes_recursive(server, children, obj_node_id, ns_index);
        }
    }
}

/* ─── Node Creation ────────────────────────────────────────────────────────── */

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
        fprintf(stderr, "Warning: Skipping node with missing name or dataType\n");
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
        /* Parse the nodeId string (format: "ns=X;s=StringId") */
        if (strncmp(node_id_str, "ns=", 3) == 0) {
            /* Skip "ns=X;s=" prefix to get the actual string identifier */
            const char *p = node_id_str + 3;
            while (*p >= '0' && *p <= '9') p++;
            if (*p == ';' && *(p+1) == 's' && *(p+2) == '=') {
                variable_node_id = UA_NODEID_STRING(ns_index, (char *)(p + 3));
            } else {
                variable_node_id = UA_NODEID_STRING(ns_index, (char *)node_id_str);
            }
        } else {
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
        fprintf(stderr, "Warning: Failed to create node '%s': %s\n",
                name, UA_StatusCode_name(status));
    }

    /* Clean up the variant data if it was allocated */
    UA_Variant_clear(&attr.value);
}

/* ─── Address Space Building ───────────────────────────────────────────────── */

static int build_address_space(UA_Server *server, cJSON *config) {
    cJSON *namespaces = cJSON_GetObjectItemCaseSensitive(config, "namespaces");
    if (!cJSON_IsArray(namespaces)) {
        fprintf(stderr, "Error: Config missing 'namespaces' array\n");
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
            fprintf(stderr, "Warning: Namespace missing 'uri', skipping\n");
            continue;
        }

        /* Register the namespace and get its index */
        UA_UInt16 ns_index = UA_Server_addNamespace(server, ns_uri);
        printf("  Registered namespace '%s' (uri: %s) at index %u\n",
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

/* ─── Security Configuration ───────────────────────────────────────────────── */

/**
 * Configure security on the OPC UA server.
 *
 * When mode is "Sign" or "SignAndEncrypt":
 *   - Loads the DER-encoded certificate and private key
 *   - Calls UA_ServerConfig_setDefaultWithSecurityPolicies() to register
 *     Basic128Rsa15, Basic256, and Basic256Sha256 security policies
 *   - For "SignAndEncrypt", removes the None endpoint so clients MUST use encryption
 *
 * When mode is "None" (or missing):
 *   - Uses the default configuration (SecurityPolicy#None only)
 *
 * Returns 0 on success, -1 on failure.
 * Must be called BEFORE UA_ServerConfig_setDefault() — this function
 * replaces the default config call entirely.
 */
static int configure_security(UA_Server *server, cJSON *security) {
    if (!security || !cJSON_IsObject(security)) {
        printf("  No security configuration, using defaults (SecurityMode: None)\n");
        UA_ServerConfig_setDefault(UA_Server_getConfig(server));
        return 0;
    }

    cJSON *mode_item = cJSON_GetObjectItemCaseSensitive(security, "mode");
    cJSON *cert_path_item = cJSON_GetObjectItemCaseSensitive(security, "certificatePath");
    cJSON *key_path_item = cJSON_GetObjectItemCaseSensitive(security, "privateKeyPath");

    const char *mode = cJSON_GetStringValue(mode_item);
    const char *cert_path = cJSON_GetStringValue(cert_path_item);
    const char *key_path = cJSON_GetStringValue(key_path_item);

    if (!mode || strcmp(mode, "None") == 0) {
        printf("  Security mode: None\n");
        UA_ServerConfig_setDefault(UA_Server_getConfig(server));
        return 0;
    }

    printf("  Security mode: %s\n", mode);

    /* For Sign or SignAndEncrypt, load certificate and private key */
    if (!cert_path || !key_path) {
        fprintf(stderr, "Error: Security mode '%s' requires certificatePath and privateKeyPath\n", mode);
        return -1;
    }

    /* Read certificate file (DER format) */
    UA_ByteString certificate = read_file_binary(cert_path);
    if (certificate.data == NULL) {
        fprintf(stderr, "Error: Cannot read certificate file '%s'\n", cert_path);
        return -1;
    }

    /* Read private key file (DER format) */
    UA_ByteString privateKey = read_file_binary(key_path);
    if (privateKey.data == NULL) {
        fprintf(stderr, "Error: Cannot read private key file '%s'\n", key_path);
        UA_ByteString_clear(&certificate);
        return -1;
    }

    printf("  Certificate loaded from: %s\n", cert_path);
    printf("  Private key loaded from: %s\n", key_path);

    /* If the private key is in PEM format, convert it to DER.
     * open62541 expects DER-encoded keys. Our cert generator produces PEM. */
    if (privateKey.length > 10 &&
        memcmp(privateKey.data, "-----BEGIN", 10) == 0) {
        /* PEM detected — strip the header/footer and base64 decode */
        /* Find the first newline after the header */
        UA_Byte *start = NULL;
        UA_Byte *end = NULL;
        for (size_t i = 0; i < privateKey.length - 1; i++) {
            if (privateKey.data[i] == '\n' && !start) {
                start = &privateKey.data[i + 1];
            }
            /* Find "-----END" */
            if (privateKey.data[i] == '-' && i + 4 < privateKey.length &&
                memcmp(&privateKey.data[i], "-----END", 8) == 0) {
                end = &privateKey.data[i];
                break;
            }
        }

        if (start && end && end > start) {
            /* Remove newlines and carriage returns from the base64 content */
            size_t b64_len = 0;
            UA_Byte *b64_buf = (UA_Byte *)UA_malloc((size_t)(end - start));
            if (!b64_buf) {
                fprintf(stderr, "Error: Memory allocation failed for PEM decode\n");
                UA_ByteString_clear(&certificate);
                UA_ByteString_clear(&privateKey);
                return -1;
            }
            for (UA_Byte *p = start; p < end; p++) {
                if (*p != '\n' && *p != '\r') {
                    b64_buf[b64_len++] = *p;
                }
            }

            /* Base64 decode */
            /* Calculate decoded size (base64: 4 chars = 3 bytes) */
            size_t decoded_max = (b64_len / 4) * 3 + 3;
            UA_Byte *decoded = (UA_Byte *)UA_malloc(decoded_max);
            if (!decoded) {
                UA_free(b64_buf);
                UA_ByteString_clear(&certificate);
                UA_ByteString_clear(&privateKey);
                return -1;
            }

            /* Simple base64 decode */
            static const unsigned char b64_table[256] = {
                ['A'] = 0,  ['B'] = 1,  ['C'] = 2,  ['D'] = 3,
                ['E'] = 4,  ['F'] = 5,  ['G'] = 6,  ['H'] = 7,
                ['I'] = 8,  ['J'] = 9,  ['K'] = 10, ['L'] = 11,
                ['M'] = 12, ['N'] = 13, ['O'] = 14, ['P'] = 15,
                ['Q'] = 16, ['R'] = 17, ['S'] = 18, ['T'] = 19,
                ['U'] = 20, ['V'] = 21, ['W'] = 22, ['X'] = 23,
                ['Y'] = 24, ['Z'] = 25, ['a'] = 26, ['b'] = 27,
                ['c'] = 28, ['d'] = 29, ['e'] = 30, ['f'] = 31,
                ['g'] = 32, ['h'] = 33, ['i'] = 34, ['j'] = 35,
                ['k'] = 36, ['l'] = 37, ['m'] = 38, ['n'] = 39,
                ['o'] = 40, ['p'] = 41, ['q'] = 42, ['r'] = 43,
                ['s'] = 44, ['t'] = 45, ['u'] = 46, ['v'] = 47,
                ['w'] = 48, ['x'] = 49, ['y'] = 50, ['z'] = 51,
                ['0'] = 52, ['1'] = 53, ['2'] = 54, ['3'] = 55,
                ['4'] = 56, ['5'] = 57, ['6'] = 58, ['7'] = 59,
                ['8'] = 60, ['9'] = 61, ['+'] = 62, ['/'] = 63,
            };

            size_t decoded_len = 0;
            for (size_t i = 0; i + 3 < b64_len; i += 4) {
                unsigned int n = ((unsigned int)b64_table[b64_buf[i]] << 18) |
                                 ((unsigned int)b64_table[b64_buf[i+1]] << 12) |
                                 ((unsigned int)b64_table[b64_buf[i+2]] << 6) |
                                 ((unsigned int)b64_table[b64_buf[i+3]]);
                decoded[decoded_len++] = (UA_Byte)((n >> 16) & 0xFF);
                if (b64_buf[i+2] != '=')
                    decoded[decoded_len++] = (UA_Byte)((n >> 8) & 0xFF);
                if (b64_buf[i+3] != '=')
                    decoded[decoded_len++] = (UA_Byte)(n & 0xFF);
            }

            UA_free(b64_buf);

            /* Replace the PEM privateKey with the DER-decoded content */
            UA_ByteString_clear(&privateKey);
            privateKey.data = decoded;
            privateKey.length = decoded_len;
            printf("  Private key converted from PEM to DER (%zu bytes)\n", decoded_len);
        }
    }

    /* Configure the server with all available security policies.
     * This registers Basic128Rsa15, Basic256, Basic256Sha256 AND None. */
    UA_StatusCode retval = UA_ServerConfig_setDefaultWithSecurityPolicies(
        UA_Server_getConfig(server),
        4840,         /* port */
        &certificate,
        &privateKey,
        NULL, 0,      /* trust list (empty — accept all client certs) */
        NULL, 0,      /* issuer list */
        NULL, 0       /* revocation list */
    );

    UA_ByteString_clear(&certificate);
    UA_ByteString_clear(&privateKey);

    if (retval != UA_STATUSCODE_GOOD) {
        fprintf(stderr, "Error: Failed to configure security policies: %s\n",
                UA_StatusCode_name(retval));
        return -1;
    }

    /* Set the ApplicationURI to match the certificate's SubjectAltName URI.
     * open62541 validates that these match on startup. We extract it from the
     * config JSON if provided, otherwise use a sensible default. */
    {
        UA_ServerConfig *cfg = UA_Server_getConfig(server);
        cJSON *app_uri_item = cJSON_GetObjectItemCaseSensitive(security, "applicationUri");
        const char *app_uri = cJSON_GetStringValue(app_uri_item);
        if (!app_uri) {
            app_uri = "urn:opcua-light-server:application";
        }
        UA_String_clear(&cfg->applicationDescription.applicationUri);
        cfg->applicationDescription.applicationUri = UA_STRING_ALLOC(app_uri);
        UA_String_clear(&cfg->applicationDescription.applicationName.text);
        cfg->applicationDescription.applicationName.text = UA_STRING_ALLOC("OPC UA Light Server");
        printf("  ApplicationURI: %s\n", app_uri);
    }

    printf("  Security policies registered (Basic128Rsa15, Basic256, Basic256Sha256)\n");

    /* Register TOFU certificate verifier if PKI paths are configured */
    {
        cJSON *pki_trusted_item = cJSON_GetObjectItemCaseSensitive(security, "pkiTrustedPath");
        cJSON *pki_rejected_item = cJSON_GetObjectItemCaseSensitive(security, "pkiRejectedPath");
        const char *pki_trusted_str = cJSON_GetStringValue(pki_trusted_item);
        const char *pki_rejected_str = cJSON_GetStringValue(pki_rejected_item);

        if (pki_trusted_str && pki_trusted_str[0] != '\0' &&
            pki_rejected_str && pki_rejected_str[0] != '\0') {
            /* Initialize the TOFU verifier context with configured paths */
            memset(&g_tofu_ctx, 0, sizeof(g_tofu_ctx));
            strncpy(g_tofu_ctx.trusted_path, pki_trusted_str, sizeof(g_tofu_ctx.trusted_path) - 1);
            strncpy(g_tofu_ctx.rejected_path, pki_rejected_str, sizeof(g_tofu_ctx.rejected_path) - 1);

            /* Replace the default AcceptAll verifier with TOFU verifier */
            UA_ServerConfig *cfg = UA_Server_getConfig(server);
            cfg->certificateVerification.context = &g_tofu_ctx;
            cfg->certificateVerification.verifyCertificate = tofu_verify_certificate;
            cfg->certificateVerification.verifyApplicationURI = NULL;
            cfg->certificateVerification.clear = NULL;

            printf("  TOFU certificate verifier registered\n");
            printf("    Trusted path: %s\n", pki_trusted_str);
            printf("    Rejected path: %s\n", pki_rejected_str);
        } else {
            printf("  PKI paths not configured, using default certificate verification\n");
        }
    }

    /* For "SignAndEncrypt" mode, remove the None endpoint so clients
     * are FORCED to use encryption. For "Sign" mode, keep None available
     * but Sign/SignAndEncrypt endpoints are also available. */
    if (strcmp(mode, "SignAndEncrypt") == 0) {
        UA_ServerConfig *config = UA_Server_getConfig(server);
        /* Remove endpoints with SecurityMode == None */
        size_t new_count = 0;
        for (size_t i = 0; i < config->endpointsSize; i++) {
            if (config->endpoints[i].securityMode != UA_MESSAGESECURITYMODE_NONE) {
                if (new_count != i) {
                    config->endpoints[new_count] = config->endpoints[i];
                }
                new_count++;
            } else {
                UA_EndpointDescription_clear(&config->endpoints[i]);
            }
        }
        config->endpointsSize = new_count;
        printf("  Removed None endpoints (%zu secure endpoint(s) remaining)\n", new_count);
    } else if (strcmp(mode, "Sign") == 0) {
        /* For Sign mode, remove SignAndEncrypt endpoints but keep Sign and None.
         * This allows clients to connect with at least message signing. */
        UA_ServerConfig *config = UA_Server_getConfig(server);
        size_t new_count = 0;
        for (size_t i = 0; i < config->endpointsSize; i++) {
            if (config->endpoints[i].securityMode != UA_MESSAGESECURITYMODE_SIGNANDENCRYPT) {
                if (new_count != i) {
                    config->endpoints[new_count] = config->endpoints[i];
                }
                new_count++;
            } else {
                UA_EndpointDescription_clear(&config->endpoints[i]);
            }
        }
        config->endpointsSize = new_count;
        printf("  Removed SignAndEncrypt endpoints (%zu endpoint(s) remaining)\n", new_count);
    }

    return 0;
}

/* ─── Address Space Clearing (for reload) ──────────────────────────────────── */

static void clear_address_space(UA_Server *server) {
    /*
     * On reload, delete all custom nodes by re-reading the current config
     * and removing each node that was previously created.
     * We delete in reverse order: variable nodes first, then object nodes,
     * then the namespace root objects.
     */
    printf("  Clearing custom address space nodes for reload...\n");

    char *json_str = read_file(g_config_path);
    if (!json_str) return;

    cJSON *config = cJSON_Parse(json_str);
    free(json_str);
    if (!config) return;

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

        /* Delete variable nodes */
        if (cJSON_IsArray(nodes_item)) {
            cJSON *node_item = NULL;
            cJSON_ArrayForEach(node_item, nodes_item) {
                cJSON *nid = cJSON_GetObjectItemCaseSensitive(node_item, "nodeId");
                const char *nid_str = cJSON_GetStringValue(nid);
                if (!nid_str) continue;

                /* Parse "ns=X;s=StringId" */
                UA_NodeId nodeId = UA_NODEID_NULL;
                if (strncmp(nid_str, "ns=", 3) == 0) {
                    const char *p = nid_str + 3;
                    while (*p >= '0' && *p <= '9') p++;
                    if (*p == ';' && *(p+1) == 's' && *(p+2) == '=') {
                        nodeId = UA_NODEID_STRING(ns_index, (char *)(p + 3));
                    }
                }
                if (!UA_NodeId_isNull(&nodeId)) {
                    UA_Server_deleteNode(server, nodeId, UA_TRUE);
                }
            }
        }

        /* Delete object nodes (recursive helper) */
        if (cJSON_IsArray(object_nodes_item)) {
            /* Delete object nodes depth-first */
            cJSON *obj_node = NULL;
            cJSON_ArrayForEach(obj_node, object_nodes_item) {
                cJSON *path_item = cJSON_GetObjectItemCaseSensitive(obj_node, "path");
                cJSON *children = cJSON_GetObjectItemCaseSensitive(obj_node, "children");
                const char *path = cJSON_GetStringValue(path_item);

                /* Recursively delete children first */
                if (cJSON_IsArray(children)) {
                    cJSON *child = NULL;
                    cJSON_ArrayForEach(child, children) {
                        cJSON *child_path = cJSON_GetObjectItemCaseSensitive(child, "path");
                        const char *cp = cJSON_GetStringValue(child_path);
                        if (cp) {
                            UA_NodeId childId = UA_NODEID_STRING(ns_index, (char *)cp);
                            UA_Server_deleteNode(server, childId, UA_TRUE);
                        }
                    }
                }

                if (path) {
                    UA_NodeId objId = UA_NODEID_STRING(ns_index, (char *)path);
                    UA_Server_deleteNode(server, objId, UA_TRUE);
                }
            }
        }

        /* Delete the namespace root object node */
        if (ns_name) {
            UA_NodeId nsRootId = UA_NODEID_STRING(ns_index, (char *)ns_name);
            UA_Server_deleteNode(server, nsRootId, UA_TRUE);
        }
    }

    cJSON_Delete(config);
    printf("  Address space cleared.\n");
}

/* ─── Reload Handler ───────────────────────────────────────────────────────── */

static void handle_reload(UA_Server *server) {
    printf("Reload requested. Re-reading config from: %s\n", g_config_path);

    char *json_str = read_file(g_config_path);
    if (!json_str) {
        fprintf(stderr, "Error: Failed to read config file during reload\n");
        return;
    }

    cJSON *config = parse_config(json_str);
    free(json_str);

    if (!config) {
        fprintf(stderr, "Error: Failed to parse config file during reload\n");
        return;
    }

    /* Clear existing custom nodes and rebuild */
    clear_address_space(server);

    /* Rebuild address space from new config */
    if (build_address_space(server, config) != 0) {
        fprintf(stderr, "Error: Failed to rebuild address space during reload\n");
    } else {
        printf("Reload complete. Address space rebuilt successfully.\n");
    }

    cJSON_Delete(config);
}

/* ─── Server Iteration Callback ────────────────────────────────────────────── */

static void server_iteration_callback(UA_Server *server, void *data) {
    (void)data;

    if (g_reload_requested) {
        g_reload_requested = 0;
        handle_reload(server);
    }

    /* Periodically update the status file with current session count */
    write_status_file(server);

    /* Check stdin for value updates (non-blocking) */
    process_stdin_updates(server);
}

/* ─── Stdin Value Update Processing ────────────────────────────────────────── */

static char g_stdin_buffer[65536] = {0};
static size_t g_stdin_buffer_len = 0;

#ifdef _WIN32
/* Windows: dedicated thread to read stdin (blocking reads in a loop) */
static HANDLE g_stdin_thread = NULL;
static volatile LONG g_stdin_running = 1;

/* Pending lines queue (simple ring buffer protected by critical section) */
#define STDIN_QUEUE_SIZE 256
static char *g_stdin_queue[STDIN_QUEUE_SIZE];
static volatile LONG g_stdin_queue_head = 0;
static volatile LONG g_stdin_queue_tail = 0;
static CRITICAL_SECTION g_stdin_cs;

static unsigned __stdcall win32_stdin_reader(void *arg) {
    (void)arg;
    HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
    if (hStdin == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Warning: stdin handle invalid, value updates disabled\n");
        return 0;
    }

    char line_buf[65536];
    size_t line_len = 0;

    while (InterlockedCompareExchange(&g_stdin_running, 1, 1)) {
        DWORD bytesRead = 0;
        char chunk[4096];
        BOOL ok = ReadFile(hStdin, chunk, sizeof(chunk), &bytesRead, NULL);
        if (!ok || bytesRead == 0) {
            /* stdin closed or error — exit thread */
            break;
        }

        /* Append to line buffer and extract complete lines */
        for (DWORD i = 0; i < bytesRead; i++) {
            if (chunk[i] == '\n') {
                line_buf[line_len] = '\0';
                if (line_len > 0) {
                    /* Enqueue the line */
                    char *copy = _strdup(line_buf);
                    if (copy) {
                        EnterCriticalSection(&g_stdin_cs);
                        LONG next_tail = (g_stdin_queue_tail + 1) % STDIN_QUEUE_SIZE;
                        if (next_tail != g_stdin_queue_head) {
                            g_stdin_queue[g_stdin_queue_tail] = copy;
                            g_stdin_queue_tail = next_tail;
                        } else {
                            free(copy); /* queue full, drop */
                        }
                        LeaveCriticalSection(&g_stdin_cs);
                    }
                }
                line_len = 0;
            } else if (chunk[i] != '\r') {
                if (line_len < sizeof(line_buf) - 1) {
                    line_buf[line_len++] = chunk[i];
                }
            }
        }
    }
    return 0;
}
#endif

/**
 * Process pending stdin lines (called from the server iteration callback).
 */
static void process_stdin_updates(UA_Server *server) {
#ifdef _WIN32
    /* Dequeue and process all pending lines */
    EnterCriticalSection(&g_stdin_cs);
    while (g_stdin_queue_head != g_stdin_queue_tail) {
        char *line = g_stdin_queue[g_stdin_queue_head];
        g_stdin_queue_head = (g_stdin_queue_head + 1) % STDIN_QUEUE_SIZE;
        LeaveCriticalSection(&g_stdin_cs);

        if (line) {
            apply_value_update(server, line);
            free(line);
        }

        EnterCriticalSection(&g_stdin_cs);
    }
    LeaveCriticalSection(&g_stdin_cs);
#else
    /* POSIX: use non-blocking read */
    static int stdin_configured = 0;
    if (!stdin_configured) {
        int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
        fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);
        stdin_configured = 1;
    }

    size_t space = sizeof(g_stdin_buffer) - g_stdin_buffer_len - 1;
    if (space == 0) { g_stdin_buffer_len = 0; space = sizeof(g_stdin_buffer) - 1; }

    ssize_t bytesRead = read(STDIN_FILENO, g_stdin_buffer + g_stdin_buffer_len, space);
    if (bytesRead <= 0) return;

    g_stdin_buffer_len += (size_t)bytesRead;
    g_stdin_buffer[g_stdin_buffer_len] = '\0';

    /* Process complete lines (newline-delimited JSON) */
    char *line_start = g_stdin_buffer;
    char *newline;
    while ((newline = strchr(line_start, '\n')) != NULL) {
        *newline = '\0';
        if (newline > line_start) {
            apply_value_update(server, line_start);
        }
        line_start = newline + 1;
    }

    /* Move remaining partial line to the beginning of the buffer */
    size_t remaining = g_stdin_buffer_len - (size_t)(line_start - g_stdin_buffer);
    if (remaining > 0 && line_start != g_stdin_buffer) {
        memmove(g_stdin_buffer, line_start, remaining);
    }
    g_stdin_buffer_len = remaining;
    g_stdin_buffer[g_stdin_buffer_len] = '\0';
#endif
}

/**
 * Parse and apply a single value update JSON message.
 * Expected format: {"type":"value_update","updates":[{"nodeId":"...","value":...},...]}
 */
static void apply_value_update(UA_Server *server, const char *json_line) {
    cJSON *root = cJSON_Parse(json_line);
    if (!root) return;

    cJSON *type_item = cJSON_GetObjectItemCaseSensitive(root, "type");
    const char *type_str = cJSON_GetStringValue(type_item);
    if (!type_str) {
        cJSON_Delete(root);
        return;
    }

    /* Handle trust_store_reload IPC message */
    if (strcmp(type_str, "trust_store_reload") == 0) {
        printf("[TOFU] Trust store reload requested via IPC\n");
        /* No-op if using direct filesystem checks per connection.
         * If caching is added, refresh the cache here. */
        cJSON_Delete(root);
        return;
    }

    if (strcmp(type_str, "value_update") != 0) {
        cJSON_Delete(root);
        return;
    }

    cJSON *updates = cJSON_GetObjectItemCaseSensitive(root, "updates");
    if (!cJSON_IsArray(updates)) {
        cJSON_Delete(root);
        return;
    }

    cJSON *update = NULL;
    cJSON_ArrayForEach(update, updates) {
        cJSON *node_id_item = cJSON_GetObjectItemCaseSensitive(update, "nodeId");
        cJSON *value_item = cJSON_GetObjectItemCaseSensitive(update, "value");

        const char *node_id_str = cJSON_GetStringValue(node_id_item);
        if (!node_id_str || !value_item || cJSON_IsNull(value_item)) continue;

        /* Parse the nodeId (format: "ns=X;s=StringId") */
        UA_NodeId nodeId = UA_NODEID_NULL;
        if (strncmp(node_id_str, "ns=", 3) == 0) {
            /* Parse namespace index */
            int ns_idx = 0;
            const char *p = node_id_str + 3;
            while (*p >= '0' && *p <= '9') {
                ns_idx = ns_idx * 10 + (*p - '0');
                p++;
            }
            if (*p == ';' && *(p+1) == 's' && *(p+2) == '=') {
                const char *str_id = p + 3;
                nodeId = UA_NODEID_STRING((UA_UInt16)ns_idx, (char *)str_id);
            }
        }

        if (UA_NodeId_isNull(&nodeId)) continue;

        /* Read the current data type of the node to set the value correctly */
        UA_Variant value;
        UA_Variant_init(&value);

        if (cJSON_IsBool(value_item)) {
            UA_Boolean val = cJSON_IsTrue(value_item) ? UA_TRUE : UA_FALSE;
            UA_Variant_setScalarCopy(&value, &val, &UA_TYPES[UA_TYPES_BOOLEAN]);
        } else if (cJSON_IsNumber(value_item)) {
            /* Default to Double for numeric values */
            UA_Double val = cJSON_GetNumberValue(value_item);
            UA_Variant_setScalarCopy(&value, &val, &UA_TYPES[UA_TYPES_DOUBLE]);
        } else if (cJSON_IsString(value_item)) {
            const char *str = cJSON_GetStringValue(value_item);
            UA_String val = UA_STRING((char *)(str ? str : ""));
            UA_Variant_setScalarCopy(&value, &val, &UA_TYPES[UA_TYPES_STRING]);
        } else {
            continue;
        }

        UA_StatusCode writeStatus = UA_Server_writeValue(server, nodeId, value);
        if (writeStatus != UA_STATUSCODE_GOOD) {
            fprintf(stderr, "  Value write failed for '%s': %s\n",
                    node_id_str, UA_StatusCode_name(writeStatus));
        }
        UA_Variant_clear(&value);
    }

    cJSON_Delete(root);
}

/* ─── Main ─────────────────────────────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: %s <config-file-path>\n", argv[0]);
        return EXIT_FAILURE;
    }

    /* Store config path for reload */
    strncpy(g_config_path, argv[1], sizeof(g_config_path) - 1);
    g_config_path[sizeof(g_config_path) - 1] = '\0';

    printf("OPC UA Light Server Runtime\n");
    printf("===========================\n");
    printf("Config file: %s\n", g_config_path);

    /* 1. Read and parse configuration file */
    char *json_str = read_file(g_config_path);
    if (!json_str) {
        return EXIT_FAILURE;
    }

    cJSON *config = parse_config(json_str);
    free(json_str);

    if (!config) {
        return EXIT_FAILURE;
    }

    /* 2. Create the OPC UA server */
    g_server = UA_Server_new();
    if (!g_server) {
        fprintf(stderr, "Error: Failed to create UA_Server\n");
        cJSON_Delete(config);
        return EXIT_FAILURE;
    }

    /* 3. Configure security settings (this also sets the default server config) */
    cJSON *security = cJSON_GetObjectItemCaseSensitive(config, "security");
    if (configure_security(g_server, security) != 0) {
        fprintf(stderr, "Error: Security configuration failed\n");
        UA_Server_delete(g_server);
        cJSON_Delete(config);
        return EXIT_FAILURE;
    }
    printf("OPC UA server configured\n");

    /* Derive status file path from config path (same directory) */
    {
        strncpy(g_status_path, g_config_path, sizeof(g_status_path) - 1);
        /* Replace filename with "status.json" */
        char *last_sep = strrchr(g_status_path, '/');
        char *last_sep_win = strrchr(g_status_path, '\\');
        if (last_sep_win && (!last_sep || last_sep_win > last_sep)) {
            last_sep = last_sep_win;
        }
        if (last_sep) {
            strcpy(last_sep + 1, "status.json");
        } else {
            strcpy(g_status_path, "status.json");
        }
        printf("Status file: %s\n", g_status_path);
    }

    /* 4. Build address space from configuration */
    printf("Building address space...\n");
    if (build_address_space(g_server, config) != 0) {
        fprintf(stderr, "Error: Failed to build address space\n");
        UA_Server_delete(g_server);
        cJSON_Delete(config);
        return EXIT_FAILURE;
    }
    printf("Address space built successfully.\n");

    cJSON_Delete(config);

    /* 5. Register signal handlers */
#ifndef _WIN32
    struct sigaction sa_reload;
    memset(&sa_reload, 0, sizeof(sa_reload));
    sa_reload.sa_handler = signal_reload_handler;
    sigemptyset(&sa_reload.sa_mask);
    sa_reload.sa_flags = 0;
    sigaction(SIGUSR1, &sa_reload, NULL);

    struct sigaction sa_shutdown;
    memset(&sa_shutdown, 0, sizeof(sa_shutdown));
    sa_shutdown.sa_handler = signal_shutdown_handler;
    sigemptyset(&sa_shutdown.sa_mask);
    sa_shutdown.sa_flags = 0;
    sigaction(SIGTERM, &sa_shutdown, NULL);
    sigaction(SIGINT, &sa_shutdown, NULL);

    printf("Signal handlers registered (SIGUSR1=reload, SIGTERM/SIGINT=shutdown)\n");
#else
    /* Windows: register console control handler for shutdown */
    SetConsoleCtrlHandler(win32_ctrl_handler, TRUE);

    /* Windows: start named pipe listener thread for reload signals */
    g_pipe_thread = (HANDLE)_beginthreadex(NULL, 0, win32_pipe_listener, NULL, 0, NULL);
    if (!g_pipe_thread) {
        fprintf(stderr, "Warning: Failed to start named pipe listener thread\n");
    }

    /* Windows: start stdin reader thread for value updates */
    InitializeCriticalSection(&g_stdin_cs);
    g_stdin_thread = (HANDLE)_beginthreadex(NULL, 0, win32_stdin_reader, NULL, 0, NULL);
    if (!g_stdin_thread) {
        fprintf(stderr, "Warning: Failed to start stdin reader thread\n");
    } else {
        printf("Stdin reader thread started (value updates via pipe)\n");
    }

    printf("Windows handlers registered (Ctrl+C=shutdown, named pipe=reload)\n");
#endif

    /* 6. Add a repeated callback to check for reload signals */
    UA_Server_addRepeatedCallback(g_server, server_iteration_callback,
                                  NULL, 500.0, NULL);

    /* 7. Run the server (blocks until g_running becomes UA_FALSE) */
    printf("Starting OPC UA server on port 4840...\n");
    UA_StatusCode status = UA_Server_run(g_server, &g_running);

    /* Cleanup */
    printf("Server shutting down...\n");

#ifdef _WIN32
    /* Stop the named pipe listener thread */
    InterlockedExchange(&g_pipe_running, 0);
    if (g_pipe_thread) {
        WaitForSingleObject(g_pipe_thread, 2000);
        CloseHandle(g_pipe_thread);
        g_pipe_thread = NULL;
    }

    /* Stop the stdin reader thread */
    InterlockedExchange(&g_stdin_running, 0);
    if (g_stdin_thread) {
        /* Cancel the blocking ReadFile by closing stdin */
        CloseHandle(GetStdHandle(STD_INPUT_HANDLE));
        WaitForSingleObject(g_stdin_thread, 2000);
        CloseHandle(g_stdin_thread);
        g_stdin_thread = NULL;
    }
    DeleteCriticalSection(&g_stdin_cs);
#endif

    UA_Server_delete(g_server);
    g_server = NULL;

    if (status != UA_STATUSCODE_GOOD) {
        fprintf(stderr, "Server exited with error: %s\n",
                UA_StatusCode_name(status));
        return EXIT_FAILURE;
    }

    printf("Server shutdown complete.\n");
    return EXIT_SUCCESS;
}
