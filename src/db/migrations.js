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

function backfillQueueSemantics(db) {
  addColumnIfMissing(db, "jobs", "last_import_batch_id", "TEXT");
  addColumnIfMissing(db, "applications", "first_viewed_at", "TEXT");

  const legacyBatchId = "legacy-import-batch";
  db.prepare(
    `
      UPDATE jobs
      SET last_import_batch_id = ?
      WHERE last_import_batch_id IS NULL OR TRIM(last_import_batch_id) = '';
    `
  ).run(legacyBatchId);

  db.prepare(
    `
      UPDATE applications
      SET first_viewed_at = COALESCE(
        first_viewed_at,
        submitted_at,
        last_action_at,
        (SELECT updated_at FROM jobs WHERE jobs.id = applications.job_id),
        (SELECT created_at FROM jobs WHERE jobs.id = applications.job_id)
      )
      WHERE status != 'new'
        AND (first_viewed_at IS NULL OR TRIM(first_viewed_at) = '');
    `
  ).run();
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
        last_import_batch_id TEXT,
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
        first_viewed_at TEXT,
        last_action_at TEXT NOT NULL,
        submitted_at TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS source_run_deltas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        semantics_version INTEGER,
        found_count INTEGER,
        filtered_count INTEGER,
        deduped_count INTEGER,
        new_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        unchanged_count INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        refresh_mode TEXT,
        served_from TEXT,
        status_reason TEXT,
        status_label TEXT,
        captured_at TEXT,
        recorded_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_source_run_deltas_source_recorded
        ON source_run_deltas (source_id, recorded_at DESC);

      CREATE INDEX IF NOT EXISTS idx_source_run_deltas_run_id
        ON source_run_deltas (run_id);
    `
  );

  addColumnIfMissing(db, "evaluations", "confidence", "INTEGER");
  addColumnIfMissing(db, "evaluations", "freshness_days", "INTEGER");
  addColumnIfMissing(db, "evaluations", "hard_filtered", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "evaluations", "evaluation_meta", "TEXT");
  addColumnIfMissing(db, "jobs", "structured_meta", "TEXT");
  addColumnIfMissing(db, "jobs", "metadata_quality_score", "INTEGER");
  addColumnIfMissing(db, "jobs", "missing_required_fields", "TEXT");
  addColumnIfMissing(db, "jobs", "last_import_batch_id", "TEXT");
  addColumnIfMissing(db, "applications", "first_viewed_at", "TEXT");
  addColumnIfMissing(db, "source_run_deltas", "refresh_mode", "TEXT");
  addColumnIfMissing(db, "source_run_deltas", "served_from", "TEXT");
  addColumnIfMissing(db, "source_run_deltas", "status_reason", "TEXT");
  addColumnIfMissing(db, "source_run_deltas", "status_label", "TEXT");
  addColumnIfMissing(db, "source_run_deltas", "captured_at", "TEXT");
  addColumnIfMissing(db, "source_run_deltas", "found_count", "INTEGER");
  addColumnIfMissing(db, "source_run_deltas", "filtered_count", "INTEGER");
  addColumnIfMissing(db, "source_run_deltas", "deduped_count", "INTEGER");
  addColumnIfMissing(db, "source_run_deltas", "semantics_version", "INTEGER");
  addColumnIfMissing(db, "source_run_deltas", "raw_found_count", "INTEGER");
  addColumnIfMissing(db, "source_run_deltas", "hard_filtered_count", "INTEGER");
  addColumnIfMissing(db, "source_run_deltas", "duplicate_collapsed_count", "INTEGER");
  addColumnIfMissing(db, "source_run_deltas", "imported_kept_count", "INTEGER");
  backfillJobNormalization(db);
  backfillQueueSemantics(db);
}
