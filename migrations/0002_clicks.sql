-- Clicks per link per UTC day, as totals only: no visitor id, cookie or IP.
CREATE TABLE clicks (
  day TEXT NOT NULL,
  link TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, link)
);
