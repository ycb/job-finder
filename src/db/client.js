import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Database location resolves in this order:
// 1. explicit dbPath argument,
// 2. JOB_FINDER_DB environment variable (absolute path recommended) — lets
//    any checkout or worktree operate on one stable, machine-local database
//    instead of a checkout-relative copy,
// 3. data/jobs.db relative to the current working directory (legacy default).
export function openDatabase(
  dbPath = process.env.JOB_FINDER_DB || "data/jobs.db"
) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON;");

  return { db, dbPath: resolvedPath };
}

