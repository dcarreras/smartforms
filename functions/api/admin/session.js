import { json, requireAdmin } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
    const admin = await requireAdmin(request, env);
    if (admin.ok) return json({ authenticated: true });
    if (admin.error.status === 401) return json({ authenticated: false });
    return admin.error;
}
