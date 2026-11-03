"use strict";
/**
 * Saved database connections.
 *
 * The profile (name, type, masked display string, flags) lives in globalState;
 * the real connection string - with its password - lives only in VS Code's
 * SecretStorage (the OS keychain), and is read back only to open a connection.
 * A credentials file (a Google service-account key) gets a SecretStorage
 * entry of its own, next to the connection string.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionStore = void 0;
const crypto_1 = require("crypto");
const cloud_1 = require("./cloud");
const gcp_1 = require("./cloud-auth/gcp");
const connection_string_1 = require("./connection-string");
const types_1 = require("./types");
const PROFILES_KEY = "devsnip.database.connections";
const secretKey = (id) => `devsnip.database.secret.${id}`;
const credentialsKey = (id) => `devsnip.database.credentials.${id}`;
const COLORS = ["blue", "green", "orange", "red", "purple", "teal", "gray"];
class ConnectionStore {
    constructor(state, secrets) {
        this.state = state;
        this.secrets = secrets;
    }
    list() {
        const profiles = this.state.get(PROFILES_KEY, []);
        return Array.isArray(profiles) ? profiles.filter(p => p && typeof p.id === "string") : [];
    }
    get(id) {
        return this.list().find(p => p.id === id);
    }
    require(id) {
        const profile = this.get(id);
        if (!profile)
            throw new types_1.DbError("That connection no longer exists.");
        return profile;
    }
    /** The stored credentials file of a connection, if it has one. */
    async credentials(id) {
        return (await this.secrets.get(credentialsKey(id))) || undefined;
    }
    /** What was typed for the credentials, or the stored file when nothing new was entered. */
    async resolveCredentials(id, typed) {
        if (typed && typed.trim())
            return typed.trim();
        return id && this.get(id) ? this.credentials(id) : undefined;
    }
    async connectionString(id) {
        const value = await this.secrets.get(secretKey(id));
        if (!value)
            throw new types_1.DbError("The saved connection string is missing from the keychain.", "Edit the connection and enter the connection string again.");
        return value;
    }
    /**
     * Resolves what the user typed for a saved connection: the masked
     * placeholder is swapped back for the stored password.
     */
    async resolve(id, typed) {
        if (!id || !(0, connection_string_1.hasMaskedPassword)(typed))
            return typed;
        return (0, connection_string_1.restoreMaskedPassword)(typed, await this.secrets.get(secretKey(id)));
    }
    async save(input, baseDir) {
        const name = String(input.name ?? "").trim();
        if (!name)
            throw new types_1.DbError("Give the connection a name.");
        if (name.length > 60)
            throw new types_1.DbError("Keep the name under 60 characters.");
        const existing = input.id ? this.require(input.id) : undefined;
        const raw = await this.resolve(existing?.id, String(input.connectionString ?? ""));
        if ((0, connection_string_1.hasMaskedPassword)(raw))
            throw new types_1.DbError("Enter the password: the saved one could not be found.");
        const spec = (0, connection_string_1.parseConnection)(raw, baseDir);
        const profiles = this.list();
        if (!existing && profiles.length >= 100)
            throw new types_1.DbError("You can save up to 100 connections.");
        // A pasted key is kept only while the connection signs in with it.
        const usesKey = spec.options.auth === "service-account" || (spec.options.auth === "gcp-iam" && !!(input.credentials?.trim() || existing?.hasCredentials));
        const credentials = usesKey ? await this.resolveCredentials(existing?.id, input.credentials) : undefined;
        if (spec.options.auth === "service-account" && !credentials)
            throw new types_1.DbError("Paste the service account key (JSON).", "Or choose Application Default Credentials.");
        if (credentials) {
            if (credentials.length > 32 * 1024)
                throw new types_1.DbError("The credentials file is too large.");
            (0, gcp_1.inspectCredentials)(credentials);
        }
        const chosen = (0, cloud_1.cloudService)(input.cloud);
        const profile = {
            id: existing?.id ?? (0, crypto_1.randomUUID)(),
            name,
            kind: spec.kind,
            display: (0, connection_string_1.maskConnectionString)(raw),
            readOnly: !!input.readOnly,
            color: COLORS.includes(String(input.color)) ? input.color : existing?.color ?? COLORS[profiles.length % COLORS.length],
            cloud: chosen && chosen.engines.some(e => e.kind === spec.kind) ? chosen.id : (0, cloud_1.inferCloudService)(spec),
            hasCredentials: credentials ? true : undefined,
            createdAt: existing?.createdAt ?? Date.now(),
            lastConnectedAt: existing?.lastConnectedAt
        };
        // The secrets are written first, so a profile never exists without its connection string.
        await this.secrets.store(secretKey(profile.id), raw.trim());
        if (credentials)
            await this.secrets.store(credentialsKey(profile.id), credentials);
        else
            await this.secrets.delete(credentialsKey(profile.id));
        await this.state.update(PROFILES_KEY, existing ? profiles.map(p => (p.id === profile.id ? profile : p)) : [...profiles, profile]);
        return profile;
    }
    async remove(id) {
        await this.state.update(PROFILES_KEY, this.list().filter(p => p.id !== id));
        await this.secrets.delete(secretKey(id));
        await this.secrets.delete(credentialsKey(id));
    }
    /**
     * Corrects the saved type when the connection string now parses as another
     * kind (mariadb:// was saved as MySQL before MariaDB had its own entry).
     */
    async setKind(id, kind) {
        const profiles = this.list();
        if (!profiles.some(p => p.id === id && p.kind !== kind))
            return;
        await this.state.update(PROFILES_KEY, profiles.map(p => (p.id === id ? { ...p, kind } : p)));
    }
    async touch(id) {
        const profiles = this.list();
        if (!profiles.some(p => p.id === id))
            return;
        await this.state.update(PROFILES_KEY, profiles.map(p => (p.id === id ? { ...p, lastConnectedAt: Date.now() } : p)));
    }
}
exports.ConnectionStore = ConnectionStore;
//# sourceMappingURL=store.js.map