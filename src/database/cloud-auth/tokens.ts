/**
 * Token authentication for cloud databases that speak an engine's wire
 * protocol: the provider's short-lived token replaces the password.
 *
 * - aws-iam: RDS / Aurora PostgreSQL, MySQL and MariaDB (a presigned token).
 * - azure-ad: Azure SQL, Azure Database for PostgreSQL and MySQL (az login).
 * - gcp-iam: Cloud SQL and AlloyDB IAM users (an OAuth access token).
 */

import { regionFromHost } from "../cloud";
import type { ConnectionSpec } from "../connection-string";
import { DbError } from "../types";
import { profileRegion, rdsAuthToken, resolveAwsCredentials } from "./aws";
import { AZURE_RESOURCES, azureCliToken } from "./azure";
import { GoogleAuth } from "./gcp";

export const TOKEN_AUTH = ["aws-iam", "azure-ad", "gcp-iam"];

const WIRE_KINDS: Record<string, string[]> = {
  "aws-iam": ["postgres", "mysql", "mariadb"],
  "azure-ad": ["postgres", "mysql", "sqlserver"],
  "gcp-iam": ["postgres", "mysql"]
};

/**
 * Replaces the password of a token-authenticated spec with a fresh token.
 * Returns the token, so it can be redacted from errors; undefined when the spec uses a password.
 */
export async function applyTokenAuth(spec: ConnectionSpec): Promise<string | undefined> {
  const auth = String(spec.options.auth ?? "").toLowerCase();
  if (!TOKEN_AUTH.includes(auth)) return undefined;
  if (!WIRE_KINDS[auth].includes(spec.kind)) throw new DbError(`${auth} authentication is not available for this database.`, "Use a user and password.");
  if (!spec.user) throw new DbError("Token authentication needs the database user name.", auth === "gcp-iam" ? "For a service account on PostgreSQL, use its email without .gserviceaccount.com." : "Enter the user the token is for.");
  let token: string;
  if (auth === "aws-iam") {
    const region = spec.options.region || regionFromHost(spec.host) || profileRegion(spec.options.profile);
    if (!region) throw new DbError("The AWS region could not be read from the host.", "Add region=us-east-1 under Options.");
    // The password field holds nothing here: IAM credentials come from the profile or the environment.
    const credentials = await resolveAwsCredentials({ ...spec, user: "", password: "", options: { ...spec.options, auth: spec.options.profile ? "profile" : "env" } });
    token = rdsAuthToken({ host: spec.host ?? "", port: spec.port ?? (spec.kind === "postgres" ? 5432 : 3306), user: spec.user, region, credentials });
  } else if (auth === "azure-ad") {
    token = await azureCliToken(spec.kind === "sqlserver" ? AZURE_RESOURCES.sql : AZURE_RESOURCES.ossrdbms);
  } else {
    token = await new GoogleAuth({ ...spec, options: { ...spec.options, auth: spec.credentials ? "service-account" : "adc" } }).accessToken();
  }
  spec.password = token;
  return token;
}
