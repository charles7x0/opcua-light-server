#include "file_io.h"
#include "logging.h"

#include <stdio.h>
#include <stdlib.h>

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
