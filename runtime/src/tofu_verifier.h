#ifndef TOFU_VERIFIER_H
#define TOFU_VERIFIER_H

#include <open62541/server.h>

typedef struct {
    char trusted_path[4096];
    char rejected_path[4096];
} TofuVerifierContext;

/**
 * Custom certificate verification callback implementing TOFU.
 * Returns:
 *   UA_STATUSCODE_BADCERTIFICATEUNTRUSTED if cert is in reject store or dirs unreadable
 *   UA_STATUSCODE_GOOD if cert is in trust store or is new (first use)
 */
UA_StatusCode tofu_verify_certificate(void *verificationContext,
                                      const UA_ByteString *certificate);

/**
 * Compute SHA-1 thumbprint of DER-encoded certificate as 40-char lowercase hex.
 * out_hex must be at least 41 bytes (40 hex chars + null terminator).
 */
void compute_thumbprint(const UA_ByteString *cert, char *out_hex);

/**
 * Re-read trust and reject directories (called on trust_store_reload IPC).
 * Currently a no-op since verification checks the filesystem per-connection.
 * Reserved for future in-memory cache optimization.
 */
void tofu_reload_trust_store(TofuVerifierContext *ctx);

#endif /* TOFU_VERIFIER_H */
