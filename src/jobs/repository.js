export function upsertJobs(db, jobs) {
  const statement = db.prepare(`
    INSERT INTO jobs (
      id,
      source,
      source_id,
      source_url,
      external_id,
      title,
      company,
      location,
      posted_at,
      employment_type,
      easy_apply,
      salary_text,
      description,
      normalized_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET
      external_id = excluded.external_id,
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      posted_at = excluded.posted_at,
      employment_type = excluded.employment_type,
      easy_apply = excluded.easy_apply,
      salary_text = excluded.salary_text,
      description = excluded.description,
      normalized_hash = excluded.normalized_hash,
      updated_at = excluded.updated_at;
  `);

  let inserted = 0;
  const newJobIds = [];

  for (const job of jobs) {
    const result = statement.run(
      job.id,
      job.source,
      job.sourceId,
      job.sourceUrl,
      job.externalId,
      job.title,
      job.company,
      job.location,
      job.postedAt,
      job.employmentType,
      job.easyApply ? 1 : 0,
      job.salaryText,
      job.description,
      job.normalizedHash,
      job.createdAt,
      job.updatedAt
    );

    if (result.changes > 0) {
      inserted += 1;
      newJobIds.push({ id: job.id, normalizedHash: job.normalizedHash });
    }
  }

  // Inherit application status from existing jobs with the same normalized_hash
  // This ensures that if a user rejected a job, new captures with the same hash
  // are also marked as rejected, preventing them from reappearing in the Active queue
  if (newJobIds.length > 0) {
    const inheritStatusStmt = db.prepare(`
      INSERT INTO applications (job_id, status, notes, last_action_at)
      SELECT ?, a.status, a.notes, a.last_action_at
      FROM applications a
      WHERE a.job_id IN (
        SELECT j.id FROM jobs j
        WHERE j.normalized_hash = ?
        AND j.id != ?
        LIMIT 1
      )
      ON CONFLICT(job_id) DO NOTHING;
    `);

    for (const { id, normalizedHash } of newJobIds) {
      if (normalizedHash) {
        inheritStatusStmt.run(id, normalizedHash, id);
      }
    }
  }

  return inserted;
}

export function pruneSourceJobs(db, sourceId, keepJobIds = []) {
  const normalizedSourceId = String(sourceId || "").trim();
  if (!normalizedSourceId) {
    return 0;
  }

  const uniqueKeepIds = Array.from(
    new Set(
      (Array.isArray(keepJobIds) ? keepJobIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  let statement;
  let params;

  if (uniqueKeepIds.length === 0) {
    statement = db.prepare(`
      DELETE FROM jobs
      WHERE source_id = ?
        AND id IN (
          SELECT j.id
          FROM jobs j
          LEFT JOIN applications a ON a.job_id = j.id
          WHERE j.source_id = ?
            AND COALESCE(a.status, 'new') IN ('new', 'viewed')
        );
    `);
    params = [normalizedSourceId, normalizedSourceId];
  } else {
    const placeholders = uniqueKeepIds.map(() => "?").join(", ");
    statement = db.prepare(`
      DELETE FROM jobs
      WHERE source_id = ?
        AND id NOT IN (${placeholders})
        AND id IN (
          SELECT j.id
          FROM jobs j
          LEFT JOIN applications a ON a.job_id = j.id
          WHERE j.source_id = ?
            AND COALESCE(a.status, 'new') IN ('new', 'viewed')
        );
    `);
    params = [normalizedSourceId, ...uniqueKeepIds, normalizedSourceId];
  }

  const result = statement.run(...params);
  return Number(result?.changes || 0);
}

export function listAllJobs(db) {
  return db
    .prepare(
      `
      SELECT
        j.*,
        e.score,
        e.bucket,
        e.summary,
        e.confidence,
        e.freshness_days AS freshnessDays,
        e.hard_filtered AS hardFiltered,
        a.status
      FROM jobs j
      LEFT JOIN evaluations e ON e.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id
      ORDER BY COALESCE(j.posted_at, j.created_at) DESC, j.created_at DESC;
    `
    )
    .all();
}

export function listTopJobs(db, limit = 20) {
  return db
    .prepare(
      `
      SELECT
        j.id,
        j.title,
        j.company,
        j.location,
        j.source_url AS sourceUrl,
        j.posted_at AS postedAt,
        e.score,
        e.bucket,
        e.summary,
        e.confidence,
        e.freshness_days AS freshnessDays,
        e.hard_filtered AS hardFiltered,
        COALESCE(a.status, 'new') AS status
      FROM jobs j
      LEFT JOIN evaluations e ON e.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id
      ORDER BY
        COALESCE(e.score, -1) DESC,
        COALESCE(j.posted_at, j.created_at) DESC
      LIMIT ?;
    `
    )
    .all(limit);
}

export function listReviewQueue(db, limit = 100) {
  return db
    .prepare(
      `
      SELECT
        j.id,
        j.normalized_hash AS normalizedHash,
        j.source,
        j.source_id AS sourceId,
        j.title,
        j.company,
        j.location,
        j.source_url AS sourceUrl,
        j.external_id AS externalId,
        j.posted_at AS postedAt,
        j.updated_at AS updatedAt,
        j.employment_type AS employmentType,
        j.salary_text AS salaryText,
        e.score,
        e.bucket,
        e.summary,
        e.reasons,
        e.confidence,
        e.freshness_days AS freshnessDays,
        e.hard_filtered AS hardFiltered,
        COALESCE(a.status, 'new') AS status,
        COALESCE(a.notes, '') AS notes
      FROM jobs j
      LEFT JOIN evaluations e ON e.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE COALESCE(a.status, 'new') != 'rejected'
      ORDER BY
        COALESCE(e.score, -1) DESC,
        COALESCE(j.posted_at, j.created_at) DESC
      LIMIT ?;
    `
    )
    .all(limit);
}

export function listAllJobsWithStatus(db, limit = 100) {
  return db
    .prepare(
      `
      SELECT
        j.id,
        j.normalized_hash AS normalizedHash,
        j.source,
        j.source_id AS sourceId,
        j.title,
        j.company,
        j.location,
        j.source_url AS sourceUrl,
        j.external_id AS externalId,
        j.posted_at AS postedAt,
        j.updated_at AS updatedAt,
        j.employment_type AS employmentType,
        j.salary_text AS salaryText,
        e.score,
        e.bucket,
        e.summary,
        e.reasons,
        e.confidence,
        e.freshness_days AS freshnessDays,
        e.hard_filtered AS hardFiltered,
        COALESCE(a.status, 'new') AS status,
        COALESCE(a.notes, '') AS notes
      FROM jobs j
      LEFT JOIN evaluations e ON e.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id
      ORDER BY
        COALESCE(a.last_action_at, j.created_at) DESC
      LIMIT ?;
    `
    )
    .all(limit);
}

export function upsertEvaluations(db, evaluations) {
  const statement = db.prepare(`
    INSERT INTO evaluations (
      job_id,
      score,
      bucket,
      summary,
      reasons,
      confidence,
      freshness_days,
      hard_filtered,
      evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      score = excluded.score,
      bucket = excluded.bucket,
      summary = excluded.summary,
      reasons = excluded.reasons,
      confidence = excluded.confidence,
      freshness_days = excluded.freshness_days,
      hard_filtered = excluded.hard_filtered,
      evaluated_at = excluded.evaluated_at;
  `);

  for (const evaluation of evaluations) {
    statement.run(
      evaluation.jobId,
      evaluation.score,
      evaluation.bucket,
      evaluation.summary,
      JSON.stringify(evaluation.reasons),
      Number.isFinite(evaluation.confidence) ? Math.round(evaluation.confidence) : null,
      Number.isFinite(evaluation.freshnessDays) ? Math.round(evaluation.freshnessDays) : null,
      evaluation.hardFiltered ? 1 : 0,
      evaluation.evaluatedAt
    );
  }
}

function upsertApplicationStatus(db, jobId, status, notes = "") {
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO applications (
      job_id,
      status,
      notes,
      draft_path,
      last_action_at,
      submitted_at
    ) VALUES (?, ?, ?, NULL, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      notes = excluded.notes,
      last_action_at = excluded.last_action_at,
      submitted_at = COALESCE(excluded.submitted_at, applications.submitted_at);
  `);

  statement.run(
    jobId,
    status,
    notes,
    now,
    status === "applied" ? now : null
  );
}

export function markApplicationStatus(db, jobId, status, notes = "") {
  upsertApplicationStatus(db, jobId, status, notes);
}

export function markApplicationStatusByNormalizedHash(
  db,
  normalizedHash,
  status,
  notes = ""
) {
  const rows = db
    .prepare(
      `
      SELECT id
      FROM jobs
      WHERE normalized_hash = ?;
    `
    )
    .all(normalizedHash);

  if (!rows.length) {
    upsertApplicationStatus(db, normalizedHash, status, notes);
    return;
  }

  for (const row of rows) {
    upsertApplicationStatus(db, row.id, status, notes);
  }
}
