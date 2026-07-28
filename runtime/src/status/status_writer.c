#include "status/status_writer.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <open62541/server.h>
#include <cJSON.h>

#include "util/logging.h"

/*
 * Access open62541 server internals to iterate sessions.
 * Required because v1.3.x does not expose a public session-iteration API.
 */
#include "server/ua_server_internal.h"

#ifdef _WIN32
#include <ws2tcpip.h>
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#endif

/* ─── Helper Functions ─────────────────────────────────────────────────────── */

/**
 * Convert a UA_DateTime (100-nanosecond intervals since 1601-01-01) to
 * an ISO 8601 UTC string (e.g. "2024-01-15T10:30:00.000Z").
 */
static void ua_datetime_to_iso8601(UA_DateTime dt, char *buf, size_t buf_size) {
    /* UA_DateTime epoch is 1601-01-01. Convert to Unix epoch (1970-01-01).
     * Difference is 11644473600 seconds. */
    UA_Int64 unix_us = (dt / 10) - (UA_Int64)11644473600000000LL;
    time_t secs = (time_t)(unix_us / 1000000);
    int millis = (int)((unix_us % 1000000) / 1000);
    if (millis < 0) millis = 0;

    struct tm tm_buf;
#ifdef _WIN32
    gmtime_s(&tm_buf, &secs);
#else
    gmtime_r(&secs, &tm_buf);
#endif

    snprintf(buf, buf_size, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
             tm_buf.tm_year + 1900, tm_buf.tm_mon + 1, tm_buf.tm_mday,
             tm_buf.tm_hour, tm_buf.tm_min, tm_buf.tm_sec, millis);
}

/**
 * Get the remote client address (IP:port) from a socket file descriptor.
 * Returns an empty string on failure.
 */
static void get_client_address(UA_SOCKET sockfd, char *buf, size_t buf_size) {
    buf[0] = '\0';
    if (sockfd == UA_INVALID_SOCKET) return;

    struct sockaddr_storage addr;
    socklen_t addr_len = sizeof(addr);

    if (getpeername((int)sockfd, (struct sockaddr *)&addr, &addr_len) != 0) return;

    if (addr.ss_family == AF_INET) {
        struct sockaddr_in *s = (struct sockaddr_in *)&addr;
        char ip[INET_ADDRSTRLEN] = {0};
        inet_ntop(AF_INET, &s->sin_addr, ip, sizeof(ip));
        snprintf(buf, buf_size, "%s:%d", ip, ntohs(s->sin_port));
    } else if (addr.ss_family == AF_INET6) {
        struct sockaddr_in6 *s = (struct sockaddr_in6 *)&addr;
        char ip[INET6_ADDRSTRLEN] = {0};
        inet_ntop(AF_INET6, &s->sin6_addr, ip, sizeof(ip));
        snprintf(buf, buf_size, "[%s]:%d", ip, ntohs(s->sin6_port));
    }
}

/**
 * Map session state to a string: "Created", "Activated", or "Closing".
 */
static const char *get_session_state_string(UA_Session *session) {
    if (!session->activated) return "Created";
    return "Activated";
}

/* ─── Public Interface ─────────────────────────────────────────────────────── */

void status_write_if_changed(RuntimeContext *ctx) {
    if (ctx->status_path[0] == '\0') return;

    UA_Server *server = ctx->server;
    if (!server) return;

    UA_ServerStatistics stats = UA_Server_getStatistics(server);
    int clients = (int)stats.ss.currentSessionCount;

    /* Build JSON using cJSON for robustness */
    cJSON *root = cJSON_CreateObject();
    if (!root) {
        LOG_ERROR("status_writer: cJSON_CreateObject failed");
        return;
    }

    cJSON_AddNumberToObject(root, "connectedClients", clients);

    /* Create sessions array */
    cJSON *sessions_arr = cJSON_AddArrayToObject(root, "sessions");
    if (!sessions_arr) {
        LOG_ERROR("status_writer: cJSON_AddArrayToObject failed");
        cJSON_Delete(root);
        return;
    }

    /* Iterate over active sessions using server internals */
    session_list_entry *sentry;
    LIST_FOREACH(sentry, &server->sessions, pointers) {
        UA_Session *session = &sentry->session;

        cJSON *sess_obj = cJSON_CreateObject();
        if (!sess_obj) continue;

        /* applicationName from clientDescription */
        const char *app_name = "";
        char app_name_buf[512] = {0};
        if (session->clientDescription.applicationName.text.length > 0 &&
            session->clientDescription.applicationName.text.data != NULL) {
            size_t len = session->clientDescription.applicationName.text.length;
            if (len >= sizeof(app_name_buf)) len = sizeof(app_name_buf) - 1;
            memcpy(app_name_buf, session->clientDescription.applicationName.text.data, len);
            app_name_buf[len] = '\0';
            app_name = app_name_buf;
        }
        cJSON_AddStringToObject(sess_obj, "applicationName", app_name);

        /* applicationUri from clientDescription */
        char app_uri_buf[1024] = {0};
        if (session->clientDescription.applicationUri.length > 0 &&
            session->clientDescription.applicationUri.data != NULL) {
            size_t len = session->clientDescription.applicationUri.length;
            if (len >= sizeof(app_uri_buf)) len = sizeof(app_uri_buf) - 1;
            memcpy(app_uri_buf, session->clientDescription.applicationUri.data, len);
            app_uri_buf[len] = '\0';
        }
        cJSON_AddStringToObject(sess_obj, "applicationUri", app_uri_buf);

        /* securityPolicyUri from the secure channel's security policy */
        char policy_uri_buf[512] = {0};
        UA_SecureChannel *channel = session->header.channel;
        if (channel && channel->securityPolicy &&
            channel->securityPolicy->policyUri.length > 0 &&
            channel->securityPolicy->policyUri.data != NULL) {
            size_t len = channel->securityPolicy->policyUri.length;
            if (len >= sizeof(policy_uri_buf)) len = sizeof(policy_uri_buf) - 1;
            memcpy(policy_uri_buf, channel->securityPolicy->policyUri.data, len);
            policy_uri_buf[len] = '\0';
        }
        cJSON_AddStringToObject(sess_obj, "securityPolicyUri", policy_uri_buf);

        /* clientAddress from the connection socket */
        char addr_buf[128] = {0};
        if (channel && channel->connection) {
            get_client_address(channel->connection->sockfd, addr_buf, sizeof(addr_buf));
        }
        cJSON_AddStringToObject(sess_obj, "clientAddress", addr_buf);

        /* connectTime — use the channel's security token creation time */
        char time_buf[64] = {0};
        UA_DateTime connect_time = 0;
        if (channel) {
            connect_time = channel->securityToken.createdAt;
        }
        if (connect_time > UA_DATETIME_UNIX_EPOCH) {
            ua_datetime_to_iso8601(connect_time, time_buf, sizeof(time_buf));
        } else {
            /* Fallback: use current time if no valid timestamp available */
            UA_DateTime now = UA_DateTime_now();
            ua_datetime_to_iso8601(now, time_buf, sizeof(time_buf));
        }
        cJSON_AddStringToObject(sess_obj, "connectTime", time_buf);

        /* sessionState */
        cJSON_AddStringToObject(sess_obj, "sessionState", get_session_state_string(session));

        cJSON_AddItemToArray(sessions_arr, sess_obj);
    }

    /* Serialize JSON to string */
    char *json_str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (!json_str) {
        LOG_ERROR("status_writer: cJSON_PrintUnformatted failed");
        return;
    }

    /* Change detection: compare with previously written JSON */
    if (ctx->last_status_json != NULL && strcmp(json_str, ctx->last_status_json) == 0) {
        /* No change — skip file write */
        free(json_str);
        return;
    }

    /* State has changed (or first invocation) — write to file */
    FILE *f = fopen(ctx->status_path, "w");
    if (!f) {
        LOG_WARN("status_writer: cannot open '%s' for writing", ctx->status_path);
        free(json_str);
        return;
    }

    fprintf(f, "%s\n", json_str);
    fclose(f);

    /* Update last_status_json with the newly written content */
    free(ctx->last_status_json);
    ctx->last_status_json = json_str;
}
