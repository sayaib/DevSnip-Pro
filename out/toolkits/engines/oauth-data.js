"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCallback = exports.OAUTH_PROVIDERS = void 0;
const types_1 = require("../types");
exports.OAUTH_PROVIDERS = {
    custom: { label: "Custom", authorize: "https://auth.example.com/oauth2/authorize", token: "https://auth.example.com/oauth2/token", scope: "openid profile email" },
    google: { label: "Google", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "openid email profile", extra: { access_type: "offline", prompt: "consent" }, note: "access_type=offline + prompt=consent returns a refresh token. Android/iOS clients use the reversed client ID as redirect scheme (com.googleusercontent.apps.XXX:/oauth2redirect)." },
    github: { label: "GitHub", authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", scope: "read:user user:email", note: "GitHub's token endpoint returns form-encoded data unless you send Accept: application/json. GitHub OAuth apps support PKCE (S256)." },
    microsoft: { label: "Microsoft Entra ID", authorize: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", scope: "openid profile email offline_access", note: "Replace {tenant} with your tenant ID, or use common / organizations / consumers." },
    auth0: { label: "Auth0", authorize: "https://{domain}/authorize", token: "https://{domain}/oauth/token", scope: "openid profile email offline_access", extra: { audience: "https://api.example.com" }, note: "Set audience to your API identifier to get a JWT access token instead of an opaque one." },
    okta: { label: "Okta", authorize: "https://{domain}/oauth2/default/v1/authorize", token: "https://{domain}/oauth2/default/v1/token", scope: "openid profile email offline_access" },
    cognito: { label: "AWS Cognito", authorize: "https://{domain}.auth.{region}.amazoncognito.com/oauth2/authorize", token: "https://{domain}.auth.{region}.amazoncognito.com/oauth2/token", scope: "openid email profile" },
    keycloak: { label: "Keycloak", authorize: "https://{host}/realms/{realm}/protocol/openid-connect/auth", token: "https://{host}/realms/{realm}/protocol/openid-connect/token", scope: "openid profile email" },
    apple: { label: "Sign in with Apple", authorize: "https://appleid.apple.com/auth/authorize", token: "https://appleid.apple.com/auth/token", scope: "name email", extra: { response_mode: "form_post" }, note: "Requesting name or email requires response_mode=form_post, so the redirect URI must be a server endpoint. The client secret is a JWT you sign with your .p8 key (ES256)." }
};
function parseCallback(url) {
    let u;
    try {
        u = new URL(url.trim());
    }
    catch {
        throw new types_1.ToolInputError("The callback is not a valid URL.");
    }
    const params = new URLSearchParams(u.search || (u.hash.startsWith("#") ? u.hash.slice(1) : ""));
    if (u.hash.length > 1 && !u.search)
        for (const [k, v] of new URLSearchParams(u.hash.slice(1)))
            params.set(k, v);
    return [...params];
}
exports.parseCallback = parseCallback;
//# sourceMappingURL=oauth-data.js.map