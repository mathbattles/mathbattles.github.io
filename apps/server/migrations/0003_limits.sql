CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- One row per scheduled job, so a job can't apply twice for the same period.
CREATE TABLE job_runs (
  job TEXT PRIMARY KEY,
  last_period TEXT NOT NULL
);
