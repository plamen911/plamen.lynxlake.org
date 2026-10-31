-- Chat API state. No table stores a visitor IP.

-- Spend in micro-dollars per period: 'YYYY-MM-DD' (day) or 'YYYY-MM' (month).
CREATE TABLE spend (
  period TEXT PRIMARY KEY,
  usd_micros INTEGER NOT NULL
);

-- Requests per visitor per hour; bucket = 'visitorHash:YYYY-MM-DDTHH'.
CREATE TABLE rate (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

-- Questions asked, kept for 30 days.
CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  question TEXT NOT NULL
);

CREATE INDEX questions_ts ON questions (ts);
