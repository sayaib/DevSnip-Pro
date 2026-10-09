"use strict";
/**
 * Saved database connections.
 *
 * The profile (name, type, masked display string, flags) lives in globalState;
 * the real connection string - with its password - lives only in VS Code's
 * SecretStorage (the OS keychain), and is read back only to open a connection.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionStore = void 0;
const crypto_1 = require("crypto");
const connection_string_1 = require("./connection-string");
const types_1 = require("./types");
const PROFILES_KEY = "devsnip.database.connections";
const secretKey = (id) => `devsnip.database.secret.${id}`;
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
        const profile = {
            id: existing?.id ?? (0, crypto_1.randomUUID)(),
            name,
            kind: spec.kind,
            display: (0, connection_string_1.maskConnectionString)(raw),
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
    async remove(id) {
        await this.state.update(PROFILES_KEY, this.list().filter(p => p.id !== id));
        await this.secrets.delete(secretKey(id));
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