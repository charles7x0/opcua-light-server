/**
 * TOFU (Trust On First Use) Certificate Verifier
 *
 * Custom certificate verification for the OPC UA runtime that replaces
 * UA_CertificateVerification_AcceptAll. Implements TOFU: unknown certificates
 * are automatically trusted on first connection and persisted to disk.
 */

#include "tofu_verifier.h"

#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#ifdef _WIN32
#include <io.h>
#define ACCESS_CHECK(path, mode) _access(path, mode)
#define F_OK 0
#define R_OK 4
#else
#include <unistd.h>
#define ACCESS_CHECK(path, mode) access(path, mode)
#endif

#include <openssl/sha.h>

/* ─── Thumbprint Computation ───────────────────────────────────────────────── */

void compute_thumbprint(const UA_ByteString *cert, char *out_hex) {
    unsigned char hash[SHA_DIGEST_LENGTH]; /* 20 bytes */

    SHA1(cert->data, cert->length, hash);

    for (int i = 0; i < SHA_DIGEST_LENGTH; i++) {
        sprintf(out_hex + i * 2, "%02x", hash[i]);
    }
    out_hex[SHA_DIGEST_LENGTH * 2] = '\0'; /* 40 chars + null terminator */
}

/* ─── Certificate Verification Callback ────────────────────────────────────── */

UA_StatusCode tofu_verify_certificate(void *verificationContext,
                                      const UA_ByteString *certificate) {
    TofuVerifierContext *ctx = (TofuVerifierContext *)verificationContext;
    char thumbprint[41];
    char path[4096 + 64]; /* directory path + / + 40 hex chars + .der + null */

    /* 1. Check if directories are accessible */
    if (ACCESS_CHECK(ctx->trusted_path, R_OK) != 0) {
        fprintf(stderr, "[TOFU] Trust store directory unreadable: %s\n",
                ctx->trusted_path);
        return UA_STATUSCODE_BADCERTIFICATEUNTRUSTED;
    }
    if (ACCESS_CHECK(ctx->rejected_path, R_OK) != 0) {
        fprintf(stderr, "[TOFU] Reject store directory unreadable: %s\n",
                ctx->rejected_path);
        return UA_STATUSCODE_BADCERTIFICATEUNTRUSTED;
    }

    /* 2. Compute thumbprint */
    compute_thumbprint(certificate, thumbprint);

    /* 3. Check reject store first (if in both stores, treat as rejected per Req 3.3) */
    snprintf(path, sizeof(path), "%s/%s.der", ctx->rejected_path, thumbprint);
    if (ACCESS_CHECK(path, F_OK) == 0) {
        printf("[TOFU] Certificate REJECTED: %s\n", thumbprint);
        return UA_STATUSCODE_BADCERTIFICATEUNTRUSTED;
    }

    /* 4. Check trust store */
    snprintf(path, sizeof(path), "%s/%s.der", ctx->trusted_path, thumbprint);
    if (ACCESS_CHECK(path, F_OK) == 0) {
        printf("[TOFU] Certificate trusted: %s\n", thumbprint);
        return UA_STATUSCODE_GOOD;
    }

    /* 5. Not in either store — Trust On First Use: save to trust store */
    printf("[TOFU] First use — trusting certificate: %s\n", thumbprint);

    FILE *fp = fopen(path, "wb");
    if (!fp) {
        fprintf(stderr, "[TOFU] Failed to open file for writing: %s\n", path);
        return UA_STATUSCODE_GOOD; /* Accept connection even on save failure */
    }

    size_t written = fwrite(certificate->data, 1, certificate->length, fp);
    if (written != certificate->length) {
        fprintf(stderr,
                "[TOFU] Failed to write certificate data for %s "
                "(wrote %zu of %zu bytes)\n",
                thumbprint, written, (size_t)certificate->length);
    }

    fclose(fp);
    return UA_STATUSCODE_GOOD;
}

/* ─── Trust Store Reload ───────────────────────────────────────────────────── */

void tofu_reload_trust_store(TofuVerifierContext *ctx) {
    /* Stub — currently a no-op since verification checks the filesystem
     * per-connection. Reserved for future in-memory cache optimization. */
    (void)ctx;
    printf("[TOFU] Trust store reload acknowledged\n");
}
