/**
 * Test helper program for validating initial value creation via subprocess invocation.
 *
 * Batch mode (reads from stdin):
 *   Input: JSON array of test cases, one per line, terminated by empty line or EOF.
 *   Each line format: <data_type> <json_value>
 *   (tab-separated: data type name, then the JSON value or "null")
 *
 *   Output: One JSON result per line to stdout:
 *     {"type_index":<number>,"type_name":"<string>","value":<value>}
 *
 * Single mode (argc == 3):
 *   Usage: test_initial_value_helper <data_type> <json_value>
 *   Output: single JSON result line to stdout
 *
 * The helper replicates the logic from create_initial_value in address_space_builder.c
 * without requiring open62541 or cJSON library linkage.
 *
 * Exit: 0 on success, 1 on error.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

/* Define UA_NS0ID constants locally */
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

/* Define UA_TYPES_* constants */
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

typedef unsigned int UA_UInt32;

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
 * Find the type_index for a given data type name.
 * Returns UA_TYPES_DOUBLE as default.
 */
static size_t find_type_index(const char *data_type) {
    for (size_t i = 0; i < DATA_TYPE_TABLE_SIZE; i++) {
        if (strcmp(data_type, DATA_TYPE_TABLE[i].name) == 0) {
            return DATA_TYPE_TABLE[i].ua_types_index;
        }
    }
    return UA_TYPES_DOUBLE;
}

/**
 * Find the type name for a given ua_types_index.
 */
static const char *find_type_name(size_t type_index) {
    for (size_t i = 0; i < DATA_TYPE_TABLE_SIZE; i++) {
        if (DATA_TYPE_TABLE[i].ua_types_index == type_index) {
            return DATA_TYPE_TABLE[i].name;
        }
    }
    return "Double";
}

/**
 * Minimal JSON string extraction: if json_value starts with '"', extract content between quotes.
 * Returns a malloc'd string or NULL.
 */
static char *extract_json_string(const char *json_value) {
    if (!json_value || json_value[0] != '"') return NULL;

    size_t len = strlen(json_value);
    if (len < 2 || json_value[len - 1] != '"') return NULL;

    size_t content_len = len - 2;
    char *result = (char *)malloc(content_len + 1);
    if (!result) return NULL;

    /* Handle basic escape sequences */
    size_t j = 0;
    for (size_t i = 1; i < len - 1; i++) {
        if (json_value[i] == '\\' && i + 1 < len - 1) {
            i++;
            switch (json_value[i]) {
                case '"': result[j++] = '"'; break;
                case '\\': result[j++] = '\\'; break;
                case 'n': result[j++] = '\n'; break;
                case 't': result[j++] = '\t'; break;
                case 'r': result[j++] = '\r'; break;
                case '/': result[j++] = '/'; break;
                default: result[j++] = '\\'; result[j++] = json_value[i]; break;
            }
        } else {
            result[j++] = json_value[i];
        }
    }
    result[j] = '\0';
    return result;
}

/**
 * Output a JSON-escaped string to stdout.
 */
static void print_json_string(const char *str) {
    putchar('"');
    for (size_t i = 0; str[i] != '\0'; i++) {
        switch (str[i]) {
            case '"': printf("\\\""); break;
            case '\\': printf("\\\\"); break;
            case '\n': printf("\\n"); break;
            case '\t': printf("\\t"); break;
            case '\r': printf("\\r"); break;
            default:
                if ((unsigned char)str[i] < 0x20) {
                    printf("\\u%04x", (unsigned char)str[i]);
                } else {
                    putchar(str[i]);
                }
                break;
        }
    }
    putchar('"');
}

/**
 * Process a single test case and output the result as a JSON line.
 */
static void process_case(const char *data_type, const char *json_value) {
    size_t type_index = find_type_index(data_type);
    const char *type_name = find_type_name(type_index);
    int is_null = (strcmp(json_value, "null") == 0);

    printf("{\"type_index\":%zu,\"type_name\":\"%s\",", type_index, type_name);

    if (is_null) {
        if (strcmp(data_type, "Boolean") == 0) {
            printf("\"value\":false");
        } else if (strcmp(data_type, "String") == 0) {
            printf("\"value\":\"\"");
        } else {
            printf("\"value\":0");
        }
    } else if (strcmp(data_type, "Boolean") == 0) {
        int val = (strcmp(json_value, "true") == 0) ? 1 : 0;
        printf("\"value\":%s", val ? "true" : "false");
    } else if (strcmp(data_type, "String") == 0) {
        char *str = extract_json_string(json_value);
        printf("\"value\":");
        if (str) {
            print_json_string(str);
            free(str);
        } else {
            printf("\"\"");
        }
    } else if (type_index == UA_TYPES_FLOAT) {
        double dval = atof(json_value);
        float fval = (float)dval;
        printf("\"value\":%.9g", (double)fval);
    } else if (type_index == UA_TYPES_INT16) {
        double dval = atof(json_value);
        int16_t ival = (int16_t)dval;
        printf("\"value\":%d", (int)ival);
    } else if (type_index == UA_TYPES_INT32) {
        double dval = atof(json_value);
        int32_t ival = (int32_t)dval;
        printf("\"value\":%d", (int)ival);
    } else if (type_index == UA_TYPES_INT64) {
        double dval = atof(json_value);
        int64_t ival = (int64_t)dval;
        printf("\"value\":%lld", (long long)ival);
    } else if (type_index == UA_TYPES_UINT16) {
        double dval = atof(json_value);
        uint16_t uval = (uint16_t)dval;
        printf("\"value\":%u", (unsigned)uval);
    } else if (type_index == UA_TYPES_UINT32) {
        double dval = atof(json_value);
        uint32_t uval = (uint32_t)dval;
        printf("\"value\":%u", (unsigned)uval);
    } else if (type_index == UA_TYPES_UINT64) {
        double dval = atof(json_value);
        uint64_t uval = (uint64_t)dval;
        printf("\"value\":%llu", (unsigned long long)uval);
    } else {
        /* Default: Double */
        double dval = atof(json_value);
        printf("\"value\":%.17g", dval);
    }

    printf("}\n");
}

int main(int argc, char *argv[]) {
    if (argc == 3) {
        /* Single mode: data_type and json_value as arguments */
        process_case(argv[1], argv[2]);
        fflush(stdout);
        return 0;
    }

    if (argc == 1) {
        /* Batch mode: read lines from stdin, each line is "data_type\tjson_value" */
        char line[65536];
        while (fgets(line, sizeof(line), stdin) != NULL) {
            /* Remove trailing newline */
            size_t len = strlen(line);
            while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
                line[--len] = '\0';
            }

            /* Skip empty lines */
            if (len == 0) continue;

            /* Find tab separator */
            char *tab = strchr(line, '\t');
            if (!tab) {
                fprintf(stderr, "Invalid line format (no tab): %s\n", line);
                continue;
            }

            *tab = '\0';
            const char *data_type = line;
            const char *json_value = tab + 1;

            process_case(data_type, json_value);
        }
        fflush(stdout);
        return 0;
    }

    fprintf(stderr, "Usage: test_initial_value_helper [<data_type> <json_value>]\n");
    fprintf(stderr, "  Single mode: pass data_type and json_value as arguments\n");
    fprintf(stderr, "  Batch mode:  pipe tab-separated lines via stdin\n");
    return 1;
}
