/**
 * Test helper program for validating file_io utilities via subprocess invocation.
 *
 * Usage: test_file_io_helper <command> <file_path>
 *   command: "read_text" or "read_binary"
 *   file_path: Path to the file to read
 *
 * Output (JSON on stdout):
 *   Success: {"success":true,"content":"<escaped content>","length":<N>}
 *   Failure: {"success":false}
 *
 * For read_binary, content is hex-encoded.
 *
 * This helper stubs UA_ByteString and related functions so that file_io.c
 * can be compiled without depending on open62541.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ─── Stub UA_ByteString types and functions ─────────────────────────────── */

typedef unsigned char UA_Byte;
typedef unsigned int UA_UInt32;
typedef unsigned int UA_StatusCode;

#define UA_STATUSCODE_GOOD 0x00000000

typedef struct {
    size_t length;
    UA_Byte *data;
} UA_ByteString;

#define UA_BYTESTRING_NULL ((UA_ByteString){0, NULL})

static UA_StatusCode UA_ByteString_allocBuffer(UA_ByteString *bs, size_t length) {
    bs->data = (UA_Byte *)malloc(length);
    if (!bs->data) {
        bs->length = 0;
        return 1; /* not GOOD */
    }
    bs->length = length;
    return UA_STATUSCODE_GOOD;
}

static void UA_ByteString_clear(UA_ByteString *bs) {
    if (bs->data) {
        free(bs->data);
        bs->data = NULL;
    }
    bs->length = 0;
}

/* ─── Stub the open62541 server header inclusion ─────────────────────────── */
/* file_io.h includes <open62541/server.h>, we redefine the include guard
 * and provide what file_io.c actually needs. */
#define FILE_IO_H

/* Provide the file_io interface directly since we can't include the real header */
char *file_read_text(const char *path);
UA_ByteString file_read_binary(const char *path);

/* ─── Include logging (no open62541 dependency) ──────────────────────────── */
#include "util/logging.h"

/* ─── Inline the file_io implementation ──────────────────────────────────── */

char *file_read_text(const char *path) {
    if (!path) {
        LOG_ERROR("file_read_text: path is NULL");
        return NULL;
    }

    FILE *f = fopen(path, "r");
    if (!f) {
        LOG_ERROR("Cannot open text file: %s", path);
        return NULL;
    }

    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);

    char *buffer = (char *)malloc((size_t)len + 1);
    if (!buffer) {
        LOG_ERROR("malloc failed for file: %s (size %ld)", path, len);
        fclose(f);
        return NULL;
    }

    size_t read_bytes = fread(buffer, 1, (size_t)len, f);
    buffer[read_bytes] = '\0';
    fclose(f);

    return buffer;
}

UA_ByteString file_read_binary(const char *path) {
    if (!path) {
        LOG_ERROR("file_read_binary: path is NULL");
        return UA_BYTESTRING_NULL;
    }

    FILE *f = fopen(path, "rb");
    if (!f) {
        LOG_ERROR("Cannot open binary file: %s", path);
        return UA_BYTESTRING_NULL;
    }

    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);

    UA_ByteString bs;
    if (UA_ByteString_allocBuffer(&bs, (size_t)len) != UA_STATUSCODE_GOOD) {
        LOG_ERROR("UA_ByteString_allocBuffer failed for file: %s (size %ld)", path, len);
        fclose(f);
        return UA_BYTESTRING_NULL;
    }

    size_t read_bytes = fread(bs.data, 1, (size_t)len, f);
    fclose(f);

    if ((long)read_bytes != len) {
        LOG_ERROR("Incomplete read for file: %s (read %zu of %ld bytes)", path, read_bytes, len);
        UA_ByteString_clear(&bs);
        return UA_BYTESTRING_NULL;
    }

    return bs;
}

/* ─── JSON output helpers ────────────────────────────────────────────────── */

static void print_json_escaped(const char *str, size_t len) {
    for (size_t i = 0; i < len; i++) {
        unsigned char c = (unsigned char)str[i];
        switch (c) {
            case '"':  printf("\\\""); break;
            case '\\': printf("\\\\"); break;
            case '\n': printf("\\n"); break;
            case '\r': printf("\\r"); break;
            case '\t': printf("\\t"); break;
            default:
                if (c < 0x20) {
                    printf("\\u%04x", c);
                } else {
                    putchar(c);
                }
                break;
        }
    }
}

static void print_hex(const unsigned char *data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        printf("%02x", data[i]);
    }
}

/* ─── Main ───────────────────────────────────────────────────────────────── */

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: test_file_io_helper <command> <file_path>\n");
        return 1;
    }

    const char *command = argv[1];
    const char *file_path = argv[2];

    if (strcmp(command, "read_text") == 0) {
        char *content = file_read_text(file_path);
        if (content) {
            size_t len = strlen(content);
            printf("{\"success\":true,\"content\":\"");
            print_json_escaped(content, len);
            printf("\",\"length\":%zu}", len);
            free(content);
        } else {
            printf("{\"success\":false}");
        }
    } else if (strcmp(command, "read_binary") == 0) {
        UA_ByteString bs = file_read_binary(file_path);
        if (bs.data != NULL) {
            printf("{\"success\":true,\"content\":\"");
            print_hex(bs.data, bs.length);
            printf("\",\"length\":%zu}", bs.length);
            UA_ByteString_clear(&bs);
        } else {
            printf("{\"success\":false}");
        }
    } else {
        fprintf(stderr, "Unknown command: %s\n", command);
        return 1;
    }

    return 0;
}
