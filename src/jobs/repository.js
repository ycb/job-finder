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
    ON CONFLICT(id) DO UPDATE SET
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
    }
  }

  return inserted;
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
        j.source,
        j.title,
        j.company,
        j.location,
        j.source_url AS sourceUrl,
        j.external_id AS externalId,
        j.posted_at AS postedAt,
        j.employment_type AS employmentType,
        j.salary_text AS salaryText,
        e.score,
        e.bucket,
        e.summary,
        e.reasons,
        COALESCE(a.status, 'new') AS status
      FROM jobs j
      LEFT JOIN evaluations e ON e.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.source = 'linkedin_capture_file'
        AND COALESCE(a.status, 'new') != 'rejected'
      ORDER BY
        COALESCE(e.score, -1) DESC,
        COALESCE(j.posted_at, j.created_at) DESC
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
      evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      score = excluded.score,
      bucket = excluded.bucket,
      summary = excluded.summary,
      reasons = excluded.reasons,
      evaluated_at = excluded.evaluated_at;
  `);

  for (const evaluation of evaluations) {
    statement.run(
      evaluation.jobId,
      evaluation.score,
      evaluation.bucket,
      evaluation.summary,
      JSON.stringify(evaluation.reasons),
      evaluation.evaluatedAt
    );
  }
}

export function markApplicationStatus(db, jobId, status) {
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO applications (
      job_id,
      status,
      notes,
      draft_path,
      last_action_at,
      submitted_at
    ) VALUES (?, ?, '', NULL, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      last_action_at = excluded.last_action_at,
      submitted_at = excluded.submitted_at;
  `);

  statement.run(
    jobId,
    status,
    now,
    status === "applied" ? now : null
  );
}
