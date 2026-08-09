CREATE TABLE profiles (
  token TEXT PRIMARY KEY,
  author_id TEXT NOT NULL UNIQUE,
  author_name TEXT NOT NULL,
  qq TEXT NOT NULL,
  github TEXT NOT NULL,
  steam TEXT NOT NULL,
  creator_types TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 64),
  password_salt TEXT NOT NULL CHECK (length(password_salt) = 32),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL,
  author_token TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author_token) REFERENCES profiles(token)
);

CREATE TABLE requirements (
  commission_id INTEGER NOT NULL,
  requirement_type TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(description) > 0),
  count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 99),
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  PRIMARY KEY (commission_id, requirement_type),
  FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_requirements_type ON requirements(requirement_type);
CREATE INDEX idx_commissions_created_at ON commissions(created_at DESC);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  profile_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (profile_token) REFERENCES profiles(token) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_profile ON sessions(profile_token);

CREATE TABLE claims (
  commission_id INTEGER NOT NULL,
  requirement_type TEXT NOT NULL,
  profile_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (commission_id, requirement_type, profile_token),
  FOREIGN KEY (commission_id, requirement_type)
    REFERENCES requirements(commission_id, requirement_type) ON DELETE CASCADE,
  FOREIGN KEY (profile_token) REFERENCES profiles(token) ON DELETE CASCADE
);

CREATE INDEX idx_claims_profile ON claims(profile_token);

CREATE TABLE commission_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_id INTEGER NOT NULL,
  content TEXT NOT NULL CHECK (length(content) > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_commission_updates_commission
  ON commission_updates(commission_id);
