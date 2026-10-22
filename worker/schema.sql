PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY, study_id TEXT NOT NULL, version INTEGER NOT NULL,
  duration REAL NOT NULL, frames INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  video_key TEXT NOT NULL, poster_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS raters (
  id TEXT PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, is_test INTEGER NOT NULL DEFAULT 0,
  role TEXT, experience TEXT, consent_version TEXT, consent_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, rater_id TEXT NOT NULL REFERENCES raters(id), expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ratings (
  rater_id TEXT NOT NULL REFERENCES raters(id), clip_id TEXT NOT NULL REFERENCES clips(id),
  score INTEGER CHECK(score BETWEEN 1 AND 5), unscorable INTEGER NOT NULL CHECK(unscorable IN (0,1)),
  reason TEXT NOT NULL, confidence TEXT NOT NULL, notes TEXT NOT NULL,
  watched_seconds REAL NOT NULL, playback_rate REAL NOT NULL, revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL, study_version INTEGER NOT NULL,
  PRIMARY KEY (rater_id, clip_id),
  CHECK ((unscorable=1 AND score IS NULL AND length(reason)>0) OR (unscorable=0 AND score IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS rating_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rater_id TEXT NOT NULL, clip_id TEXT NOT NULL,
  payload TEXT NOT NULL, saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_limits (
  key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE INDEX IF NOT EXISTS clips_study ON clips(study_id);
