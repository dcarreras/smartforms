const STORAGE_KEY = "smartforms-anonymous-daily-visit";

function utcDay() {
    return new Date().toISOString().slice(0, 10);
}

function createVisitorId() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function visitorForToday() {
    const day = utcDay();
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (saved?.day === day && typeof saved.id === "string") return saved.id;
        const id = createVisitorId();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ day, id }));
        return id;
    } catch {
        return createVisitorId();
    }
}

async function recordAnonymousVisit() {
    if (!globalThis.crypto?.getRandomValues || !globalThis.fetch) return;
    if ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && location.port === "3000") return;
    try {
        await fetch("/api/analytics/visit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ visitorId: visitorForToday() }),
            keepalive: true,
            credentials: "omit"
        });
    } catch {}
}

recordAnonymousVisit();
