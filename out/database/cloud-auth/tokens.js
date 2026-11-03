"use strict";
/**
 * Token authentication for cloud databases that speak an engine's wire
 * protocol: the provider's short-lived token replaces the password.
 *
 * - aws-iam: RDS / Aurora PostgreSQL, MySQL and MariaDB (a presigned token).
 * - azure-ad: Azure SQL, Azure Database for PostgreSQL and MySQL (az login).
 * - gcp-iam: Cloud SQL and AlloyDB IAM users (an OAuth access token).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyTokenAuth = exports.TOKEN_AUTH = void 0;
const cloud_1 = require("../cloud");
const types_1 = require("../types");
const aws_1 = require("./aws");
const azure_1 = require("./azure");
const gcp_1 = require("./gcp");
exports.TOKEN_AUTH = ["aws-iam", "azure-ad", "gcp-iam"];
const WIRE_KINDS = {
    "aws-iam": ["postgres", "mysql", "mariadb"],
    "azure-ad": ["postgres", "mysql", "sqlserver"],
    "gcp-iam": ["postgres", "mysql"]
};
/**
 * Replaces the password of a token-authenticated spec with a fresh token.
 * Returns the token, so it can be redacted from errors; undefined when the spec uses a password.
 */
async function applyTokenAuth(spec) {
    const auth = String(spec.options.auth ?? "").toLowerCase();
    if (!exports.TOKEN_AUTH.includes(auth))
        return undefined;
    if (!WIRE_KINDS[auth].includes(spec.kind))
        throw new types_1.DbError(`${auth} authentication is not available for this database.`, "Use a user and password.");
    if (!spec.user)
        throw new types_1.DbError("Token authentication needs the database user name.", auth === "gcp-iam" ? "For a service account on PostgreSQL, use its email without .gserviceaccount.com." : "Enter the user the token is for.");
    let token;
    if (auth === "aws-iam") {
        const region = spec.options.region || (0, cloud_1.regionFromHost)(spec.host) || (0, aws_1.profileRegion)(spec.options.profile);
        if (!region)
            throw new types_1.DbError("The AWS region could not be read from the host.", "Add region=us-east-1 under Options.");
        // The password field holds nothing here: IAM credentials come from the profile or the environment.
        const credentials = await (0, aws_1.resolveAwsCredentials)({ ...spec, user: "", password: "", options: { ...spec.options, auth: spec.options.profile ? "profile" : "env" } });
        token = (0, aws_1.rdsAuthToken)({ host: spec.host ?? "", port: spec.port ?? (spec.kind === "postgres" ? 5432 : 3306), user: spec.user, region, credentials });
    }
    else if (auth === "azure-ad") {
        token = await (0, azure_1.azureCliToken)(spec.kind === "sqlserver" ? azure_1.AZURE_RESOURCES.sql : azure_1.AZURE_RESOURCES.ossrdbms);
    }
    else {
        token = await new gcp_1.GoogleAuth({ ...spec, options: { ...spec.options, auth: spec.credentials ? "service-account" : "adc" } }).accessToken();
    }
    spec.password = token;
    return token;
}
exports.applyTokenAuth = applyTokenAuth;
//# sourceMappingURL=tokens.js.map