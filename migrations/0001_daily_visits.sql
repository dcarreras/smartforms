CREATE TABLE IF NOT EXISTS daily_visits (
    visit_date TEXT NOT NULL,
    visitor_hash TEXT NOT NULL,
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (visit_date, visitor_hash)
);
