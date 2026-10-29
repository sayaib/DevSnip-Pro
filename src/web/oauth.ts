import { ToolInputError } from "../toolkits/types";
import { randomBytes } from "./random";
export { OAUTH_PROVIDERS, parseCallback } from "../toolkits/engines/oauth-data";
export const randomToken = (bytes = 16): string => randomBytes(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function pkcePair(verifier?: string): Promise<{ verifier: string; challenge: string }> {
  const value = verifier?.trim() || randomToken(32);
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(value)) throw new ToolInputError("A code_verifier must be 43-128 unreserved characters (RFC 7636).");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return { verifier: value, challenge: (await import("buffer")).Buffer.from(hash).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
}
