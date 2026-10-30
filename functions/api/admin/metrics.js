import { json, requireAdmin } from "../../_lib/auth.js";

function dayOffset(offset) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - offset);
    return day.toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
    const admin = await requireAdmin(request, env);
    if (admin.error) return admin.error;
    if (!env.ANALYTICS_DB) return json({ error: "Analytics storage is not configured." }, 503);
    const days = Array.from({ length: 30 }, (_, index) => dayOffset(29 - index));
    const [visitsResult, lastSeenResult] = await Promise.all([
        env.ANALYTICS_DB.prepare("SELECT visit_date AS day, COUNT(*) AS visits FROM daily_visits WHERE visit_date >= ? GROUP BY visit_date ORDER BY visit_date ASC").bind(days[0]).all(),
        env.ANALYTICS_DB.prepare("SELECT MAX(first_seen_at) AS lastSeenAt FROM daily_visits").first()
    ]);
    const visitsByDay = new Map((visitsResult.results || []).map(row => [row.day, Number(row.visits)]));
    const daily = days.map(day => ({ day, visits: visitsByDay.get(day) || 0 }));
    const sum = rows => rows.reduce((total, row) => total + row.visits, 0);
    return json({
        today: daily.at(-1).visits,
        last7Days: sum(daily.slice(-7)),
        last30Days: sum(daily),
        lastSeenAt: lastSeenResult?.lastSeenAt || null,
        daily
    });
}
