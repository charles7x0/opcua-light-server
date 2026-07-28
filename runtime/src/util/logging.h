#ifndef LOGGING_H
#define LOGGING_H

#include <stdio.h>
#include <stdarg.h>

/*
 * Structured logging macros — strictly C11 compliant.
 *
 * The variadic macro problem: in C11, `#define M(fmt, ...)` requires at least
 * one argument for `...`. Using `##__VA_ARGS__` (GNU) or `__VA_OPT__` (C23)
 * both trigger -Wpedantic warnings in C11 mode.
 *
 * Solution: Use inline helper functions that accept va_list formatting. The
 * macros just call these functions. This avoids the variadic macro issue
 * entirely while keeping the same call-site syntax.
 */

static inline void log_error_impl(const char *fmt, ...)
{
    if (!fmt) return;
    va_list args;
    va_start(args, fmt);
    fprintf(stderr, "[ERROR] ");
    vfprintf(stderr, fmt, args);
    fprintf(stderr, "\n");
    fflush(stderr);
    va_end(args);
}

static inline void log_warn_impl(const char *fmt, ...)
{
    if (!fmt) return;
    va_list args;
    va_start(args, fmt);
    fprintf(stderr, "[WARN] ");
    vfprintf(stderr, fmt, args);
    fprintf(stderr, "\n");
    fflush(stderr);
    va_end(args);
}

static inline void log_info_impl(const char *fmt, ...)
{
    if (!fmt) return;
    va_list args;
    va_start(args, fmt);
    fprintf(stdout, "[INFO] ");
    vfprintf(stdout, fmt, args);
    fprintf(stdout, "\n");
    fflush(stdout);
    va_end(args);
}

#define LOG_ERROR log_error_impl
#define LOG_WARN  log_warn_impl
#define LOG_INFO  log_info_impl

#endif /* LOGGING_H */
