-- Answers a visitor rated, kept for 30 days. No visitor id, cookie value or IP.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  vote TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL
);

CREATE INDEX feedback_ts ON feedback (ts);
