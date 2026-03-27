export function upsertJobs(db, jobs, options = {}) {
  const lastImportBatchId =
    typeof options?.lastImportBatchId === "string" && options.lastImportBatchId.trim()
      ? options.lastImportBatchId.trim()
      : null;
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
      structured_meta,
      metadata_quality_score,
      missing_required_fields,
      last_import_batch_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      structured_meta = excluded.structured_meta,
      metadata_quality_score = excluded.metadata_quality_score,
      missing_required_fields = excluded.missing_required_fields,
      last_import_batch_id = COALESCE(excluded.last_import_batch_id, jobs.last_import_batch_id),
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
      job.structuredMeta ? JSON.stringify(job.structuredMeta) : null,
      Number.isFinite(Number(job.metadataQualityScore))
        ? Math.round(Number(job.metadataQualityScore))
        : null,
      Array.isArray(job.missingRequiredFields)
        ? JSON.stringify(job.missingRequiredFields)
        : null,
      lastImportBatchId,
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

  let targetIdsSql;
  let params;

  if (uniqueKeepIds.length === 0) {
    targetIdsSql = `
      SELECT j.id
      FROM jobs j
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.source_id = ?
        AND COALESCE(a.status, 'new') IN ('new', 'viewed')
    `;
    params = [normalizedSourceId];
  } else {
    const placeholders = uniqueKeepIds.map(() => "?").join(", ");
    targetIdsSql = `
      SELECT j.id
      FROM jobs j
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE j.source_id = ?
        AND j.id NOT IN (${placeholders})
        AND COALESCE(a.status, 'new') IN ('new', 'viewed')
    `;
    params = [normalizedSourceId, ...uniqueKeepIds];
  }

  const deleteEvaluations = db.prepare(`
    DELETE FROM evaluations
    WHERE job_id IN (${targetIdsSql});
  `);
  const deleteApplications = db.prepare(`
    DELETE FROM applications
    WHERE job_id IN (${targetIdsSql});
  `);
  const deleteJobs = db.prepare(`
    DELETE FROM jobs
    WHERE id IN (${targetIdsSql});
  `);

  db.exec("BEGIN;");
  try {
    deleteEvaluations.run(...params);
    deleteApplications.run(...params);
    const result = deleteJobs.run(...params);
    db.exec("COMMIT;");
    return Number(result?.changes || 0);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

export function listSourceJobsForDelta(db, sourceId) {
  return db
    .prepare(
      `
      SELECT
        id,
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
        structured_meta,
        metadata_quality_score,
        missing_required_fields
      FROM jobs
      WHERE source_id = ?;
    `
    )
    .all(String(sourceId || "").trim());
}

export function recordSourceRunDeltas(db, rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const normalizeOptionalCount = (value) =>
    value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
      ? Math.max(0, Math.round(Number(value)))
      : null;

  const statement = db.prepare(`
    INSERT INTO source_run_deltas (
      run_id,
      source_id,
      found_count,
      filtered_count,
      deduped_count,
      new_count,
      updated_count,
      unchanged_count,
      imported_count,
      refresh_mode,
      served_from,
      status_reason,
      status_label,
      captured_at,
      recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  let inserted = 0;

  for (const row of rows) {
    const runId = String(row?.runId || "").trim();
    const sourceId = String(row?.sourceId || "").trim();
    if (!runId || !sourceId) {
      continue;
    }

    statement.run(
      runId,
      sourceId,
      normalizeOptionalCount(row?.foundCount),
      normalizeOptionalCount(row?.filteredCount),
      normalizeOptionalCount(row?.dedupedCount),
      Math.max(0, Math.round(Number(row?.newCount) || 0)),
      Math.max(0, Math.round(Number(row?.updatedCount) || 0)),
      Math.max(0, Math.round(Number(row?.unchangedCount) || 0)),
      Math.max(0, Math.round(Number(row?.importedCount) || 0)),
      row?.refreshMode ? String(row.refreshMode) : null,
      row?.servedFrom ? String(row.servedFrom) : null,
      row?.statusReason ? String(row.statusReason) : null,
      row?.statusLabel ? String(row.statusLabel) : null,
      row?.capturedAt ? String(row.capturedAt) : null,
      row?.recordedAt ? String(row.recordedAt) : new Date().toISOString()
    );
    inserted += 1;
  }

  return inserted;
}

export function listLatestSourceRunDeltas(db) {
  return db
    .prepare(
      `
      SELECT
        latest.run_id AS runId,
        latest.source_id AS sourceId,
        latest.found_count AS foundCount,
        latest.filtered_count AS filteredCount,
        latest.deduped_count AS dedupedCount,
        latest.new_count AS newCount,
        latest.updated_count AS updatedCount,
        latest.unchanged_count AS unchangedCount,
        latest.imported_count AS importedCount,
        latest.refresh_mode AS refreshMode,
        latest.served_from AS servedFrom,
        latest.status_reason AS statusReason,
        latest.status_label AS statusLabel,
        latest.captured_at AS capturedAt,
        latest.recorded_at AS recordedAt
      FROM source_run_deltas latest
      WHERE latest.id = (
        SELECT candidate.id
        FROM source_run_deltas candidate
        WHERE candidate.source_id = latest.source_id
        ORDER BY candidate.recorded_at DESC, candidate.id DESC
        LIMIT 1
      )
      ORDER BY latest.source_id ASC;
    `
    )
    .all();
}

export function listSourceRunTotals(db) {
  return db
    .prepare(
      `
      SELECT
        source_id AS sourceId,
        SUM(imported_count) AS importedCount,
        SUM(found_count) AS foundCount,
        SUM(filtered_count) AS filteredCount,
        SUM(deduped_count) AS dedupedCount,
        COUNT(found_count) AS foundSamples,
        COUNT(filtered_count) AS filteredSamples,
        COUNT(deduped_count) AS dedupedSamples
      FROM source_run_deltas
      GROUP BY source_id
      ORDER BY source_id ASC;
    `
    )
    .all();
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
        a.status,
        a.first_viewed_at AS firstViewedAt,
        j.last_import_batch_id AS lastImportBatchId
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
        COALESCE(a.status, 'new') AS status,
        a.first_viewed_at AS firstViewedAt,
        j.last_import_batch_id AS lastImportBatchId
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
        j.structured_meta AS structuredMeta,
        j.metadata_quality_score AS metadataQualityScore,
        j.missing_required_fields AS missingRequiredFields,
        j.last_import_batch_id AS lastImportBatchId,
        e.score,
        e.bucket,
        e.summary,
        e.reasons,
        e.confidence,
        e.freshness_days AS freshnessDays,
        e.hard_filtered AS hardFiltered,
        COALESCE(a.status, 'new') AS status,
        COALESCE(a.notes, '') AS notes,
        a.first_viewed_at AS firstViewedAt
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
        j.structured_meta AS structuredMeta,
        j.metadata_quality_score AS metadataQualityScore,
        j.missing_required_fields AS missingRequiredFields,
        j.last_import_batch_id AS lastImportBatchId,
        e.score,
        e.bucket,
        e.summary,
        e.reasons,
        e.confidence,
        e.freshness_days AS freshnessDays,
        e.hard_filtered AS hardFiltered,
        COALESCE(a.status, 'new') AS status,
        COALESCE(a.notes, '') AS notes,
        a.first_viewed_at AS firstViewedAt
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
      evaluation_meta,
      confidence,
      freshness_days,
      hard_filtered,
      evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      score = excluded.score,
      bucket = excluded.bucket,
      summary = excluded.summary,
      reasons = excluded.reasons,
      evaluation_meta = excluded.evaluation_meta,
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
      evaluation.evaluationMeta &&
      typeof evaluation.evaluationMeta === "object" &&
      !Array.isArray(evaluation.evaluationMeta)
        ? JSON.stringify(evaluation.evaluationMeta)
        : null,
      Number.isFinite(evaluation.confidence) ? Math.round(evaluation.confidence) : null,
      Number.isFinite(evaluation.freshnessDays) ? Math.round(evaluation.freshnessDays) : null,
      evaluation.hardFiltered ? 1 : 0,
      evaluation.evaluatedAt
    );
  }
}

function upsertApplicationStatus(db, jobId, status, notes = "") {
  const now = new Date().toISOString();
  const firstViewedAt = status === "new" ? null : now;
  const statement = db.prepare(`
    INSERT INTO applications (
      job_id,
      status,
      notes,
      draft_path,
      first_viewed_at,
      last_action_at,
      submitted_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      notes = excluded.notes,
      first_viewed_at = COALESCE(applications.first_viewed_at, excluded.first_viewed_at),
      last_action_at = excluded.last_action_at,
      submitted_at = COALESCE(excluded.submitted_at, applications.submitted_at);
  `);

  statement.run(
    jobId,
    status,
    notes,
    firstViewedAt,
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

export function getLatestImportedRunId(db) {
  const row = db
    .prepare(
      `
      SELECT run_id AS runId
      FROM source_run_deltas
      ORDER BY recorded_at DESC, id DESC
      LIMIT 1;
    `
    )
    .get();

  return typeof row?.runId === "string" && row.runId.trim() ? row.runId : null;
}
