import { json, sameOrigin } from "../../_lib/auth.js";

const visitorIdPattern = /^[A-Za-z0-9_-]{22,128}$/;

function utcDay() {
    return new Date().toISOString().slice(0, 10);
}

async function visitorHash(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
    if (!sameOrigin(request)) return json({ error: "Invalid origin." }, 403);
    if (!env.ANALYTICS_DB) return json({ error: "Analytics storage is not configured." }, 503);
    let visitorId;
    try {
        ({ visitorId } = await request.json());
    } catch {
        return json({ error: "Invalid request." }, 400);
    }
    if (typeof visitorId !== "string" || !visitorIdPattern.test(visitorId)) return json({ error: "Invalid visitor id." }, 400);
    const result = await env.ANALYTICS_DB.prepare("INSERT OR IGNORE INTO daily_visits (visit_date, visitor_hash) VALUES (?, ?)").bind(utcDay(), await visitorHash(visitorId)).run();
    return json({ recorded: (result.meta?.changes || 0) === 1 }, 201);
}
