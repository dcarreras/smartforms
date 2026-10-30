const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");
const loginError = document.getElementById("loginError");
const dashboardError = document.getElementById("dashboardError");

function setView(authenticated) {
    loginView.hidden = authenticated;
    dashboardView.hidden = !authenticated;
}

function formatLastSeen(value) {
    if (!value) return "No visits recorded yet.";
    return `Last visit: ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(`${value}Z`))}`;
}

function renderChart(daily) {
    const chart = document.getElementById("dailyChart");
    const maximum = Math.max(1, ...daily.map(item => item.visits));
    chart.replaceChildren(...daily.map(item => {
        const row = document.createElement("li");
        row.title = `${item.day}: ${item.visits} anonymous visits`;
        const bar = document.createElement("span");
        bar.style.setProperty("--height", `${Math.max(3, Math.round(item.visits / maximum * 100))}%`);
        bar.dataset.value = String(item.visits);
        row.append(bar);
        return row;
    }));
}

async function loadMetrics() {
    dashboardError.textContent = "";
    const response = await fetch("/api/admin/metrics", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
        setView(false);
        return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load analytics.");
    document.getElementById("todayValue").textContent = data.today;
    document.getElementById("last7Value").textContent = data.last7Days;
    document.getElementById("last30Value").textContent = data.last30Days;
    document.getElementById("lastSeenValue").textContent = formatLastSeen(data.lastSeenAt);
    renderChart(data.daily);
    setView(true);
}

document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    loginError.textContent = "";
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") })
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        loginError.textContent = data.error || "Could not sign in.";
        return;
    }
    formElement.reset();
    try {
        await loadMetrics();
    } catch (error) {
        dashboardError.textContent = error.message;
        setView(true);
    }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
    setView(false);
});

document.getElementById("refreshButton").addEventListener("click", async () => {
    try {
        await loadMetrics();
    } catch (error) {
        dashboardError.textContent = error.message;
    }
});

async function initializeAdmin() {
    const response = await fetch("/api/admin/session", { credentials: "same-origin", cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not check the admin session.");
    if (!data.authenticated) {
        setView(false);
        return;
    }
    await loadMetrics();
}

initializeAdmin().catch(error => {
    loginError.textContent = error.message;
    setView(false);
});
