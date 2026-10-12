CREATE TABLE IF NOT EXISTS snapshots (
  hour TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_observed_at ON snapshots(observed_at DESC);
