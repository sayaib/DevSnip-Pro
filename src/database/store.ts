/**
 * Saved database connections.
 *
 * The profile (name, type, masked display string, flags) lives in globalState;
 * the real connection string - with its password - lives only in VS Code's
 * SecretStorage (the OS keychain), and is read back only to open a connection.
 */

import { randomUUID } from "crypto";
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
const COLORS = ["blue", "green", "orange", "red", "purple", "teal", "gray"];

export interface SaveInput {
  id?: string;
  name: string;
  connectionString: string;
  readOnly?: boolean;
  color?: string;
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
    const profile: ConnectionProfile = {
      id: existing?.id ?? randomUUID(),
      name,
      kind: spec.kind,
      display: maskConnectionString(raw),
      readOnly: !!input.readOnly,
      color: COLORS.includes(String(input.color)) ? input.color : existing?.color ?? COLORS[profiles.length % COLORS.length],
      createdAt: existing?.createdAt ?? Date.now(),
      lastConnectedAt: existing?.lastConnectedAt
    };
    // The secret is written first, so a profile never exists without its connection string.
    await this.secrets.store(secretKey(profile.id), raw.trim());
    await this.state.update(PROFILES_KEY, existing ? profiles.map(p => (p.id === profile.id ? profile : p)) : [...profiles, profile]);
    return profile;
  }

  async remove(id: string): Promise<void> {
    await this.state.update(PROFILES_KEY, this.list().filter(p => p.id !== id));
    await this.secrets.delete(secretKey(id));
  }

  async touch(id: string): Promise<void> {
    const profiles = this.list();
    if (!profiles.some(p => p.id === id)) return;
    await this.state.update(PROFILES_KEY, profiles.map(p => (p.id === id ? { ...p, lastConnectedAt: Date.now() } : p)));
  }
}
