/**
 * Test helper program for validating logging macros via subprocess invocation.
 *
 * Usage: test_logging_helper <message> <level>
 *   message: The string to log (passed as a plain string, not a format specifier)
 *   level:   One of "error", "warn", "info"
 *
 * The program calls the corresponding LOG_* macro with the given message
 * and exits with 0 on success, 1 on invalid arguments.
 */
#include "util/logging.h"
#include <string.h>

int main(int argc, char *argv[]) {
    if (argc != 3) {
        return 1;
    }

    const char *message = argv[1];
    const char *level = argv[2];

    if (strcmp(level, "error") == 0) {
        LOG_ERROR("%s", message);
    } else if (strcmp(level, "warn") == 0) {
        LOG_WARN("%s", message);
    } else if (strcmp(level, "info") == 0) {
        LOG_INFO("%s", message);
    } else {
        return 1;
    }

    return 0;
}
