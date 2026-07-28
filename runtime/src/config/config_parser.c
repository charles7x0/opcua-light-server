#include "config_parser.h"
#include "util/file_io.h"
#include "util/logging.h"

#include <stdlib.h>
#include <cJSON.h>

cJSON *config_parse_file(const char *path) {
    if (!path) {
        LOG_ERROR("config_parse_file: path is NULL");
        return NULL;
    }

    char *json_str = file_read_text(path);
    if (!json_str) {
        LOG_ERROR("config_parse_file: failed to read file: %s", path);
        return NULL;
    }

    cJSON *root = cJSON_Parse(json_str);
    free(json_str);

    if (!root) {
        const char *error_ptr = cJSON_GetErrorPtr();
        if (error_ptr) {
            LOG_ERROR("JSON parse error near: %s", error_ptr);
        } else {
            LOG_ERROR("JSON parse error in config file: %s", path);
        }
        return NULL;
    }

    /* Validate required top-level fields */
    cJSON *namespaces = cJSON_GetObjectItemCaseSensitive(root, "namespaces");
    if (!cJSON_IsArray(namespaces)) {
        LOG_ERROR("Config missing 'namespaces' array in: %s", path);
        cJSON_Delete(root);
        return NULL;
    }

    return root;
}
