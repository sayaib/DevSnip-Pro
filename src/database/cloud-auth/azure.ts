/**
 * Azure authentication: Cosmos DB master-key signatures, and Microsoft Entra
 * ID access tokens from the Azure CLI (`az login`) for Azure SQL, Azure
 * Database for PostgreSQL and Azure Database for MySQL.
 */

import { createHmac } from "crypto";
import { execFile } from "child_process";
import { DbError } from "../types";

/**
 * The Authorization header of a Cosmos DB REST request signed with the account key.
 * `resourceLink` is case-sensitive: "dbs/app/colls/users" for a container,
 * "dbs/app/colls/users/docs/42" for a document, "" for the account's database list.
 */
export function cosmosAuthorization(verb: string, resourceType: string, resourceLink: string, date: string, key: string): string {
  const payload = `${verb.toLowerCase()}\n${resourceType.toLowerCase()}\n${resourceLink}\n${date.toLowerCase()}\n\n`;
  let secret: Buffer;
  try {
    secret = Buffer.from(key, "base64");
  } catch {
    throw new DbError("The AccountKey is not valid base64.");
  }
  const signature = createHmac("sha256", secret).update(payload, "utf8").digest("base64");
  return encodeURIComponent(`type=master&ver=1.0&sig=${signature}`);
}

/** Token audiences of the Azure database services. */
export const AZURE_RESOURCES = {
  sql: "https://database.windows.net/",
  ossrdbms: "https://ossrdbms-aad.database.windows.net"
};

const cache = new Map<string, { token: string; expiresAt: number }>();

/** An Entra ID access token for `resource`, from the signed-in Azure CLI. */
export function azureCliToken(resource: string): Promise<string> {
  const cached = cache.get(resource);
  if (cached && cached.expiresAt - Date.now() > 120_000) return Promise.resolve(cached.token);
  return new Promise((resolve, reject) => {
    execFile(process.platform === "win32" ? "az.cmd" : "az", ["account", "get-access-token", "--resource", resource, "--output", "json"], { timeout: 30_000, windowsHide: true, shell: process.platform === "win32" }, (error, stdout, stderr) => {
      if (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        reject(new DbError(
          missing ? "The Azure CLI was not found." : `The Azure CLI could not get a token: ${String(stderr || error.message).trim().split("\n").pop()?.slice(0, 300)}`,
          missing ? "Install the Azure CLI and run az login, or use a user and password." : "Run az login (and az account set to the right subscription), then try again."
        ));
        return;
      }
      try {
        const json = JSON.parse(String(stdout)) as { accessToken?: string; expiresOn?: string; expires_on?: number };
        if (!json.accessToken) throw new Error("no token");
        const expiresAt = json.expires_on ? json.expires_on * 1000 : Date.parse(String(json.expiresOn ?? "")) || Date.now() + 30 * 60_000;
        cache.set(resource, { token: json.accessToken, expiresAt });
        resolve(json.accessToken);
      } catch {
        reject(new DbError("The Azure CLI did not return an access token.", "Run az login, then try again."));
      }
    });
  });
}
