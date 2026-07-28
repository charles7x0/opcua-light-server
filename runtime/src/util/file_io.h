#ifndef FILE_IO_H
#define FILE_IO_H

#include <open62541/server.h>

/* Read a text file. Returns malloc'd string (caller frees) or NULL on error. */
char *file_read_text(const char *path);

/* Read a binary file into a UA_ByteString. Returns UA_BYTESTRING_NULL on error. */
UA_ByteString file_read_binary(const char *path);

#endif /* FILE_IO_H */
