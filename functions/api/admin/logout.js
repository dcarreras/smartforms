import { clearSession, json, sameOrigin } from "../../_lib/auth.js";

export async function onRequestPost({ request }) {
    if (!sameOrigin(request)) return json({ error: "Invalid origin." }, 403);
    return json({ authenticated: false }, 200, { "set-cookie": clearSession(request) });
}
