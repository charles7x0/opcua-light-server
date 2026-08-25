/**
 * Security Configuration Module
 *
 * Configures OPC UA security policies, handles PEM-to-DER conversion using
 * OpenSSL EVP_DecodeBlock, filters endpoints by security mode, and registers
 * the TOFU certificate verifier.
 */

#include "security/security_config.h"
#include "security/tofu_verifier.h"
#include "util/file_io.h"
#include "util/logging.h"

#include <open62541/server_config_default.h>
#include <openssl/evp.h>
#include <string.h>

/* Security policy URI for "None" — used to filter it out in SignAndEncrypt mode */
static const UA_String UA_SECURITY_POLICY_NONE_URI_LOCAL =
    {47, (UA_Byte *)"http://opcfoundation.org/UA/SecurityPolicy#None"};

/* ─── PEM-to-DER Conversion ────────────────────────────────────────────────── */

/**
 * Convert a PEM-formatted private key (UA_ByteString) to DER in-place.
 * Returns 0 on success (privateKey is replaced with DER content),
 * -1 on failure (privateKey is cleared).
 */
static int pem_to_der(UA_ByteString *privateKey) {
    /* Find the first newline after the PEM header */
    UA_Byte *start = NULL;
    UA_Byte *end = NULL;

    for (size_t i = 0; i < privateKey->length - 1; i++) {
        if (privateKey->data[i] == '\n' && !start) {
            start = &privateKey->data[i + 1];
        }
        /* Find "-----END" */
        if (privateKey->data[i] == '-' && i + 8 <= privateKey->length &&
            memcmp(&privateKey->data[i], "-----END", 8) == 0) {
            end = &privateKey->data[i];
            break;
        }
    }

    if (!start || !end || end <= start) {
        LOG_ERROR("PEM structure invalid: cannot find header/footer boundaries");
        return -1;
    }

    /* Remove CR/LF from the base64 body */
    size_t b64_len = 0;
    UA_Byte *b64_buf = (UA_Byte *)UA_malloc((size_t)(end - start));
    if (!b64_buf) {
        LOG_ERROR("Memory allocation failed for PEM base64 buffer");
        return -1;
    }

    for (UA_Byte *p = start; p < end; p++) {
        if (*p != '\n' && *p != '\r') {
            b64_buf[b64_len++] = *p;
        }
    }

    /* Decode using OpenSSL EVP_DecodeBlock */
    size_t decoded_max = (b64_len / 4) * 3 + 3;
    UA_Byte *decoded = (UA_Byte *)UA_malloc(decoded_max);
    if (!decoded) {
        LOG_ERROR("Memory allocation failed for PEM decode output");
        UA_free(b64_buf);
        return -1;
    }

    int raw_decoded_len = EVP_DecodeBlock(decoded, b64_buf, (int)b64_len);
    if (raw_decoded_len <= 0) {
        LOG_ERROR("PEM base64 decode failed");
        UA_free(b64_buf);
        UA_free(decoded);
        return -1;
    }

    /* Adjust for base64 padding: EVP_DecodeBlock includes padding bytes */
    int padding = 0;
    if (b64_len > 0 && b64_buf[b64_len - 1] == '=') padding++;
    if (b64_len > 1 && b64_buf[b64_len - 2] == '=') padding++;
    size_t decoded_len = (size_t)(raw_decoded_len - padding);

    UA_free(b64_buf);

    /* Replace the PEM privateKey with the DER-decoded content */
    UA_ByteString_clear(privateKey);
    privateKey->data = decoded;
    privateKey->length = decoded_len;

    LOG_INFO("Private key converted from PEM to DER (%zu bytes)", decoded_len);
    return 0;
}

/* ─── Security Configuration ───────────────────────────────────────────────── */

int security_configure(RuntimeContext *ctx, cJSON *security_json) {
    UA_Server *server = ctx->server;

    if (!security_json || !cJSON_IsObject(security_json)) {
        LOG_INFO("No security configuration, using defaults (SecurityMode: None)");
        UA_ServerConfig_setDefault(UA_Server_getConfig(server));
        return 0;
    }

    cJSON *mode_item = cJSON_GetObjectItemCaseSensitive(security_json, "mode");
    cJSON *cert_path_item = cJSON_GetObjectItemCaseSensitive(security_json, "certificatePath");
    cJSON *key_path_item = cJSON_GetObjectItemCaseSensitive(security_json, "privateKeyPath");

    const char *mode = cJSON_GetStringValue(mode_item);
    const char *cert_path = cJSON_GetStringValue(cert_path_item);
    const char *key_path = cJSON_GetStringValue(key_path_item);

    if (!mode || strcmp(mode, "None") == 0) {
        LOG_INFO("Security mode: None");
        UA_ServerConfig_setDefault(UA_Server_getConfig(server));
        return 0;
    }

    LOG_INFO("Security mode: %s", mode);

    /* For Sign or SignAndEncrypt, load certificate and private key */
    if (!cert_path || !key_path) {
        LOG_ERROR("Security mode '%s' requires certificatePath and privateKeyPath", mode);
        return -1;
    }

    /* Read certificate file (DER format) */
    UA_ByteString certificate = file_read_binary(cert_path);
    if (certificate.data == NULL) {
        LOG_ERROR("Cannot read certificate file '%s'", cert_path);
        return -1;
    }

    /* Read private key file (DER format) */
    UA_ByteString privateKey = file_read_binary(key_path);
    if (privateKey.data == NULL) {
        LOG_ERROR("Cannot read private key file '%s'", key_path);
        UA_ByteString_clear(&certificate);
        return -1;
    }

    LOG_INFO("Certificate loaded from: %s", cert_path);
    LOG_INFO("Private key loaded from: %s", key_path);

    /* If the private key is in PEM format, convert it to DER.
     * open62541 expects DER-encoded keys. Our cert generator produces PEM. */
    if (privateKey.length > 10 &&
        memcmp(privateKey.data, "-----BEGIN", 10) == 0) {
        if (pem_to_der(&privateKey) != 0) {
            UA_ByteString_clear(&certificate);
            UA_ByteString_clear(&privateKey);
            return -1;
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
        LOG_ERROR("Failed to configure security policies: %s",
                  UA_StatusCode_name(retval));
        return -1;
    }

    /* Set the ApplicationURI to match the certificate's SubjectAltName URI.
     * open62541 validates that these match on startup. We extract it from the
     * config JSON if provided, otherwise use a sensible default. */
    {
        UA_ServerConfig *cfg = UA_Server_getConfig(server);
        cJSON *app_uri_item = cJSON_GetObjectItemCaseSensitive(security_json, "applicationUri");
        const char *app_uri = cJSON_GetStringValue(app_uri_item);
        if (!app_uri) {
            app_uri = "urn:opcua-light-server:application";
        }
        UA_String_clear(&cfg->applicationDescription.applicationUri);
        cfg->applicationDescription.applicationUri = UA_STRING_ALLOC(app_uri);
        UA_String_clear(&cfg->applicationDescription.applicationName.text);
        cfg->applicationDescription.applicationName.text = UA_STRING_ALLOC("OPC UA Light Server");
        LOG_INFO("ApplicationURI: %s", app_uri);
    }

    LOG_INFO("Security policies registered (Basic128Rsa15, Basic256, Basic256Sha256)");

    /* Register TOFU certificate verifier if PKI paths are configured */
    {
        cJSON *pki_trusted_item = cJSON_GetObjectItemCaseSensitive(security_json, "pkiTrustedPath");
        cJSON *pki_rejected_item = cJSON_GetObjectItemCaseSensitive(security_json, "pkiRejectedPath");
        const char *pki_trusted_str = cJSON_GetStringValue(pki_trusted_item);
        const char *pki_rejected_str = cJSON_GetStringValue(pki_rejected_item);

        if (pki_trusted_str && pki_trusted_str[0] != '\0' &&
            pki_rejected_str && pki_rejected_str[0] != '\0') {
            /* Initialize the TOFU verifier context with configured paths */
            memset(&ctx->tofu_ctx, 0, sizeof(ctx->tofu_ctx));
            strncpy(ctx->tofu_ctx.trusted_path, pki_trusted_str,
                    sizeof(ctx->tofu_ctx.trusted_path) - 1);
            strncpy(ctx->tofu_ctx.rejected_path, pki_rejected_str,
                    sizeof(ctx->tofu_ctx.rejected_path) - 1);

            /* Replace the default AcceptAll verifier with TOFU verifier */
            UA_ServerConfig *cfg = UA_Server_getConfig(server);
            cfg->certificateVerification.context = &ctx->tofu_ctx;
            cfg->certificateVerification.verifyCertificate = tofu_verify_certificate;
            cfg->certificateVerification.verifyApplicationURI = tofu_verify_application_uri;
            cfg->certificateVerification.clear = NULL;

            LOG_INFO("TOFU certificate verifier registered");
            LOG_INFO("  Trusted path: %s", pki_trusted_str);
            LOG_INFO("  Rejected path: %s", pki_rejected_str);
        } else {
            LOG_INFO("PKI paths not configured, using default certificate verification");
        }
    }

    /* For "SignAndEncrypt" mode, remove the None endpoint so clients
     * are FORCED to use encryption. For "Sign" mode, keep None available
     * but Sign/SignAndEncrypt endpoints are also available. */
    if (strcmp(mode, "SignAndEncrypt") == 0) {
        UA_ServerConfig *config = UA_Server_getConfig(server);

        /* Remove the None security policy so it cannot be negotiated at all */
        size_t new_policy_count = 0;
        for (size_t i = 0; i < config->securityPoliciesSize; i++) {
            if (!UA_String_equal(&config->securityPolicies[i].policyUri,
                                 &UA_SECURITY_POLICY_NONE_URI_LOCAL)) {
                if (new_policy_count != i) {
                    config->securityPolicies[new_policy_count] = config->securityPolicies[i];
                }
                new_policy_count++;
            } else {
                if (config->securityPolicies[i].clear) {
                    config->securityPolicies[i].clear(&config->securityPolicies[i]);
                }
            }
        }
        config->securityPoliciesSize = new_policy_count;

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
        LOG_INFO("Removed None security policy and endpoints (%zu secure endpoint(s) remaining)", new_count);
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
        LOG_INFO("Removed SignAndEncrypt endpoints (%zu endpoint(s) remaining)", new_count);
    }

    return 0;
}
