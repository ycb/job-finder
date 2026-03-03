export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      external_id TEXT,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT,
      posted_at TEXT,
      employment_type TEXT,
      easy_apply INTEGER NOT NULL DEFAULT 0,
      salary_text TEXT,
      description TEXT NOT NULL,
      normalized_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    DROP INDEX IF EXISTS idx_jobs_source_url;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_id_url
      ON jobs (source_id, source_url);

    CREATE TABLE IF NOT EXISTS evaluations (
      job_id TEXT PRIMARY KEY,
      score INTEGER NOT NULL,
      bucket TEXT NOT NULL,
      summary TEXT NOT NULL,
      reasons TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS applications (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      draft_path TEXT,
      last_action_at TEXT NOT NULL,
      submitted_at TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
    );
  `);
}
