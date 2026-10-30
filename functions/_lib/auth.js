const encoder = new TextEncoder();
const sessionDurationSeconds = 60 * 60 * 8;

function base64UrlEncode(value) {
    return btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function sign(value, secret) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return base64UrlEncode(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equal(left, right) {
    const a = encoder.encode(left);
    const b = encoder.encode(right);
    let difference = a.length ^ b.length;
    for (let index = 0; index < Math.max(a.length, b.length); index++) difference |= (a[index] || 0) ^ (b[index] || 0);
    return difference === 0;
}

function cookieName(request) {
    return new URL(request.url).protocol === "https:" ? "__Host-smartforms_admin" : "smartforms_admin";
}

function cookieValue(request, name) {
    const cookies = request.headers.get("Cookie") || "";
    return cookies.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function configuration(env) {
    return env.ADMIN_USERNAME && env.ADMIN_PASSWORD && env.ADMIN_SESSION_SECRET;
}

export function json(body, status = 200, headers = {}) {
    return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function sameOrigin(request) {
    const origin = request.headers.get("Origin");
    return !origin || origin === new URL(request.url).origin;
}

export async function createSession(request, env) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const value = base64UrlEncode(encoder.encode(JSON.stringify({ iat: issuedAt, exp: issuedAt + sessionDurationSeconds })));
    const token = `${value}.${await sign(value, env.ADMIN_SESSION_SECRET)}`;
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionDurationSeconds}${secure}`;
}

export async function requireAdmin(request, env) {
    if (!configuration(env)) return { error: json({ error: "Admin authentication is not configured." }, 503) };
    const token = cookieValue(request, cookieName(request));
    const [value, signature] = token.split(".");
    if (!value || !signature || !equal(signature, await sign(value, env.ADMIN_SESSION_SECRET))) return { error: json({ error: "Unauthorized." }, 401) };
    try {
        const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
        if (!Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return { error: json({ error: "Session expired." }, 401) };
    } catch {
        return { error: json({ error: "Unauthorized." }, 401) };
    }
    return { ok: true };
}

export function validCredentials(username, password, env) {
    return configuration(env) && equal(username, env.ADMIN_USERNAME) && equal(password, env.ADMIN_PASSWORD);
}

export function clearSession(request) {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return `${cookieName(request)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}
