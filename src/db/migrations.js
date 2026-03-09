import { normalizeStoredJobForDedupe } from "../jobs/normalize.js";

function hasColumn(db, tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName});`).all();
  return rows.some((row) => row?.name === columnName);
}

function addColumnIfMissing(db, tableName, columnName, definitionSql) {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definitionSql};`);
  }
}

function backfillJobNormalization(db) {
  const rows = db
    .prepare(
      `
      SELECT
        id,
        source,
        source_id,
        source_url,
        external_id,
        title,
        company,
        location,
        normalized_hash
      FROM jobs;
    `
    )
    .all();

  const update = db.prepare(`
    UPDATE jobs
    SET
      external_id = ?,
      company = ?,
      location = ?,
      normalized_hash = ?
    WHERE id = ?;
  `);

  for (const row of rows) {
    const normalized = normalizeStoredJobForDedupe(row);
    if (!normalized?.normalizedHash) {
      continue;
    }

    const nextExternalId = normalized.externalId || null;
    const nextCompany = normalized.company || row.company;
    const nextLocation = normalized.location || null;
    const nextHash = normalized.normalizedHash;

    const changed =
      String(row.external_id || "") !== String(nextExternalId || "") ||
      String(row.company || "") !== String(nextCompany || "") ||
      String(row.location || "") !== String(nextLocation || "") ||
      String(row.normalized_hash || "") !== String(nextHash || "");

    if (!changed) {
      continue;
    }

    update.run(nextExternalId, nextCompany, nextLocation, nextHash, row.id);
  }
}

export function runMigrations(db) {
  db.exec(
    `
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
        structured_meta TEXT,
        metadata_quality_score INTEGER,
        missing_required_fields TEXT,
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
        evaluation_meta TEXT,
        confidence INTEGER,
        freshness_days INTEGER,
        hard_filtered INTEGER NOT NULL DEFAULT 0,
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
    `
  );

  addColumnIfMissing(db, "evaluations", "confidence", "INTEGER");
  addColumnIfMissing(db, "evaluations", "freshness_days", "INTEGER");
  addColumnIfMissing(db, "evaluations", "hard_filtered", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "evaluations", "evaluation_meta", "TEXT");
  addColumnIfMissing(db, "jobs", "structured_meta", "TEXT");
  addColumnIfMissing(db, "jobs", "metadata_quality_score", "INTEGER");
  addColumnIfMissing(db, "jobs", "missing_required_fields", "TEXT");
  backfillJobNormalization(db);
}
