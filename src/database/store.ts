/**
 * Saved database connections.
 *
 * The profile (name, type, masked display string, flags) lives in globalState;
 * the real connection string - with its password - lives only in VS Code's
 * SecretStorage (the OS keychain), and is read back only to open a connection.
 * A credentials file (a Google service-account key) gets a SecretStorage
 * entry of its own, next to the connection string.
 */

import { randomUUID } from "crypto";
import { cloudService, inferCloudService } from "./cloud";
import { inspectCredentials } from "./cloud-auth/gcp";
import { hasMaskedPassword, maskConnectionString, parseConnection, restoreMaskedPassword } from "./connection-string";
import { ConnectionProfile, DbError } from "./types";

export interface StateLike {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SecretsLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

const PROFILES_KEY = "devsnip.database.connections";
const secretKey = (id: string) => `devsnip.database.secret.${id}`;
const credentialsKey = (id: string) => `devsnip.database.credentials.${id}`;
const COLORS = ["blue", "green", "orange", "red", "purple", "teal", "gray"];

export interface SaveInput {
  id?: string;
  name: string;
  connectionString: string;
  readOnly?: boolean;
  color?: string;
  /** Cloud service id (CLOUD_SERVICES) the user picked; inferred from the host when missing. */
  cloud?: string;
  /** A newly entered credentials file; undefined keeps the stored one. */
  credentials?: string;
}

export class ConnectionStore {
  constructor(private readonly state: StateLike, private readonly secrets: SecretsLike) {}

  list(): ConnectionProfile[] {
    const profiles = this.state.get<ConnectionProfile[]>(PROFILES_KEY, []);
    return Array.isArray(profiles) ? profiles.filter(p => p && typeof p.id === "string") : [];
  }

  get(id: string): ConnectionProfile | undefined {
    return this.list().find(p => p.id === id);
  }

  require(id: string): ConnectionProfile {
    const profile = this.get(id);
    if (!profile) throw new DbError("That connection no longer exists.");
    return profile;
  }

  /** The stored credentials file of a connection, if it has one. */
  async credentials(id: string): Promise<string | undefined> {
    return (await this.secrets.get(credentialsKey(id))) || undefined;
  }

  /** What was typed for the credentials, or the stored file when nothing new was entered. */
  async resolveCredentials(id: string | undefined, typed: string | undefined): Promise<string | undefined> {
    if (typed && typed.trim()) return typed.trim();
    return id && this.get(id) ? this.credentials(id) : undefined;
  }

  async connectionString(id: string): Promise<string> {
    const value = await this.secrets.get(secretKey(id));
    if (!value) throw new DbError("The saved connection string is missing from the keychain.", "Edit the connection and enter the connection string again.");
    return value;
  }

  /**
   * Resolves what the user typed for a saved connection: the masked
   * placeholder is swapped back for the stored password.
   */
  async resolve(id: string | undefined, typed: string): Promise<string> {
    if (!id || !hasMaskedPassword(typed)) return typed;
    return restoreMaskedPassword(typed, await this.secrets.get(secretKey(id)));
  }

  async save(input: SaveInput, baseDir?: string): Promise<ConnectionProfile> {
    const name = String(input.name ?? "").trim();
    if (!name) throw new DbError("Give the connection a name.");
    if (name.length > 60) throw new DbError("Keep the name under 60 characters.");
    const existing = input.id ? this.require(input.id) : undefined;
    const raw = await this.resolve(existing?.id, String(input.connectionString ?? ""));
    if (hasMaskedPassword(raw)) throw new DbError("Enter the password: the saved one could not be found.");
    const spec = parseConnection(raw, baseDir);
    const profiles = this.list();
    if (!existing && profiles.length >= 100) throw new DbError("You can save up to 100 connections.");
    // A pasted key is kept only while the connection signs in with it.
    const usesKey = spec.options.auth === "service-account" || (spec.options.auth === "gcp-iam" && !!(input.credentials?.trim() || existing?.hasCredentials));
    const credentials = usesKey ? await this.resolveCredentials(existing?.id, input.credentials) : undefined;
    if (spec.options.auth === "service-account" && !credentials) throw new DbError("Paste the service account key (JSON).", "Or choose Application Default Credentials.");
    if (credentials) {
      if (credentials.length > 32 * 1024) throw new DbError("The credentials file is too large.");
      inspectCredentials(credentials);
    }
    const chosen = cloudService(input.cloud);
    const profile: ConnectionProfile = {
      id: existing?.id ?? randomUUID(),
      name,
      kind: spec.kind,
      display: maskConnectionString(raw),
      readOnly: !!input.readOnly,
      color: COLORS.includes(String(input.color)) ? input.color : existing?.color ?? COLORS[profiles.length % COLORS.length],
      cloud: chosen && chosen.engines.some(e => e.kind === spec.kind) ? chosen.id : inferCloudService(spec),
      hasCredentials: credentials ? true : undefined,
      createdAt: existing?.createdAt ?? Date.now(),
      lastConnectedAt: existing?.lastConnectedAt
    };
    // The secrets are written first, so a profile never exists without its connection string.
    await this.secrets.store(secretKey(profile.id), raw.trim());
    if (credentials) await this.secrets.store(credentialsKey(profile.id), credentials);
    else await this.secrets.delete(credentialsKey(profile.id));
    await this.state.update(PROFILES_KEY, existing ? profiles.map(p => (p.id === profile.id ? profile : p)) : [...profiles, profile]);
    return profile;
  }

  async remove(id: string): Promise<void> {
    await this.state.update(PROFILES_KEY, this.list().filter(p => p.id !== id));
    await this.secrets.delete(secretKey(id));
    await this.secrets.delete(credentialsKey(id));
  }

  /**
   * Corrects the saved type when the connection string now parses as another
   * kind (mariadb:// was saved as MySQL before MariaDB had its own entry).
   */
  async setKind(id: string, kind: ConnectionProfile["kind"]): Promise<void> {
    const profiles = this.list();
    if (!profiles.some(p => p.id === id && p.kind !== kind)) return;
    await this.state.update(PROFILES_KEY, profiles.map(p => (p.id === id ? { ...p, kind } : p)));
  }

  async touch(id: string): Promise<void> {
    const profiles = this.list();
    if (!profiles.some(p => p.id === id)) return;
    await this.state.update(PROFILES_KEY, profiles.map(p => (p.id === id ? { ...p, lastConnectedAt: Date.now() } : p)));
  }
}
