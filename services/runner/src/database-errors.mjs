// What resolver code sees when `caps.db` fails (worker-database.mjs): one line, bounded, the password removed. A
// pure module (no imports), so its unit test runs in the fast suite.

/** Node's certificate-chain refusals: the server's root is not one the connection trusts. */
const UNTRUSTED_CODES = new Set(["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT"]);
/** The same refusals by OpenSSL's reason (mysql2 overwrites the code); Node spelled "self signed" before 17. */
const UNTRUSTED_REASON = /^(?:self[- ]signed certificate(?: in certificate chain)?|unable to get local issuer certificate|unable to get issuer certificate|unable to verify the first certificate)$/;

export const TLS_UNSUPPORTED = "tls_unsupported: the database server does not offer TLS; enable TLS on the server";
export const TLS_UNTRUSTED = "tls_untrusted_certificate: add your provider's CA certificate to the connection (RDS, Cloud SQL and Supabase need one)";
export const TLS_NAME_MISMATCH = "tls_name_mismatch: the server's certificate does not name this host; connect with a host name the certificate lists";

/**
 * A tunnel refusal is its bare code; a server without TLS (`error.tlsUnsupported`, set by the postgres client when the
 * server answered its SSLRequest with 'N', or mysql2's HANDSHAKE_NO_SSL_SUPPORT), an untrusted certificate chain and a
 * name mismatch are `tls_unsupported`, `tls_untrusted_certificate` and `tls_name_mismatch`; a server error is
 * `database_error: SQLSTATE message`; anything else `database_error: CODE` (another TLS refusal is Node's code).
 */
export function describeDatabaseError(error, secrets = []) {
    let text;
    const code = typeof error?.code === "string" ? error.code : null;
    if (error?.tunnel) text = String(error.code);
    else if (error?.tlsUnsupported || code === "HANDSHAKE_NO_SSL_SUPPORT") text = TLS_UNSUPPORTED;
    else if (error?.name === "PostgresError") text = `database_error: ${error.code ?? ""} ${error.message}`;
    // mysql2: a server error carries its SQLSTATE; never `error.sql`, the statement.
    else if (typeof error?.sqlState === "string" && typeof error.sqlMessage === "string") text = `database_error: ${error.sqlState} ${error.sqlMessage}`;
    else if (code === "ERR_TLS_CERT_ALTNAME_INVALID") text = TLS_NAME_MISMATCH;
    else if (code && UNTRUSTED_CODES.has(code)) text = TLS_UNTRUSTED;
    // mysql2 overwrites a TLS failure's code with HANDSHAKE_SSL_ERROR on Node's own error: a name mismatch carries the
    // checked host and certificate; a chain refusal is known by OpenSSL's reason, its message.
    else if (code === "HANDSHAKE_SSL_ERROR") {
        const reason = String(error.message ?? "");
        text = error.reason !== undefined && error.cert ? TLS_NAME_MISMATCH : UNTRUSTED_REASON.test(reason) ? TLS_UNTRUSTED : `database_error: HANDSHAKE_SSL_ERROR ${reason}`;
    }
    else text = `database_error: ${code ?? String(error?.message ?? "failed")}`;
    for (const secret of secrets) if (secret) text = text.split(secret).join("[redacted]");
    return text.split(/\r?\n/, 1)[0].slice(0, 300);
}
