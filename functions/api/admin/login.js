import { createSession, json, sameOrigin, validCredentials } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
    if (!sameOrigin(request)) return json({ error: "Invalid origin." }, 403);
    let username;
    let password;
    try {
        ({ username, password } = await request.json());
    } catch {
        return json({ error: "Invalid request." }, 400);
    }
    if (typeof username !== "string" || typeof password !== "string" || !validCredentials(username, password, env)) return json({ error: "Incorrect username or password." }, 401);
    return json({ authenticated: true }, 200, { "set-cookie": await createSession(request, env) });
}
