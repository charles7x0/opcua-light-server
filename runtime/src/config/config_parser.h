#ifndef CONFIG_PARSER_H
#define CONFIG_PARSER_H

#include <cJSON.h>

/**
 * Read and parse a JSON config file.
 *
 * Reads the file at `path` using file_read_text, parses the JSON content,
 * and validates that a top-level "namespaces" array is present.
 *
 * Returns the cJSON root object on success (caller is responsible for freeing
 * via cJSON_Delete), or NULL on error with LOG_ERROR messages emitted.
 */
cJSON *config_parse_file(const char *path);

#endif /* CONFIG_PARSER_H */
