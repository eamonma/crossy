#!/usr/bin/env node
// Expand-only guard for the deploy pipeline (DESIGN.md section 9; INV-7).
//
// Every committed migration is expand-only by hard rule (CLAUDE.md): additive columns,
// indexes, grants. The auto-migrate job runs this guard before applying migrations, so an
// accidental destructive or lock-hazardous statement cannot ride a push-to-main deploy ahead
// of the roll. If a migration trips the deny-list the job FAILS and points at the manual
// escape hatch (workflow_dispatch, migrations_only=true), where contract-phase migrations are
// applied deliberately by the owner.
//
// Plain node, zero dependencies: it runs as `node deploy/migration-guard.mjs` with no install,
// so a guard failure is the cheapest, fastest signal in the job. The pure functions are also
// imported by packages/db's vitest suite (its .d.mts companion carries the types); keep the two
// in sync.
//
// It scans ALL committed migrations, not just the pending ones. That keeps the guard stateless
// (no DB round-trip to learn what is applied) and simple. The current tree is clean under the
// deny-list with one exception, 0001_real_schema.sql, which drops the transient bootstrap
// scaffold table; that file is grandfathered in ALLOWLIST below. A migration deliberately
// applied through the manual escape hatch (a reviewed contract/destructive change) stays in the
// folder forever, so it must be added to ALLOWLIST in the same PR or every later auto-deploy
// would trip on it.

/* global process, console */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed Drizzle migrations (same folder migrator.ts applies). */
export const DEFAULT_MIGRATIONS_DIR = resolve(HERE, "../packages/db/drizzle");

// Deny-list. Conservative on purpose: false-positive friction (a safe statement flagged, then
// routed through the manual escape hatch) is acceptable; a silently auto-applied destructive
// statement is not. Each pattern matches against SQL with comments and single-quoted string
// literals already stripped (see stripNoise), so a comment or a literal mentioning a keyword
// does not trip it. Foreign-key referential actions (ON DELETE / ON UPDATE ...) are neutralized
// first, so a constraint definition is never mistaken for DML.
export const DENY_RULES = [
  {
    name: "DROP",
    // Destroys a schema object (table, column, index, constraint, type). On an API-owned
    // surface the session service reads, that is the contract phase of expand/contract and
    // must be deliberate (section 9). Matched broadly: DROP NOT NULL / DROP DEFAULT are
    // technically safe yet still flagged, which is the conservative side to err on.
    pattern: /\bDROP\b/i,
  },
  {
    name: "RENAME",
    // A rename is a breaking change in one deploy: old code reads the old name, new code the
    // new name, and the two services deploy independently against one database (section 9).
    // Add-new-plus-backfill instead.
    pattern: /\bRENAME\b/i,
  },
  {
    name: "TRUNCATE",
    // Mass row deletion that also takes an ACCESS EXCLUSIVE lock. Never valid in an automated
    // expand migration.
    pattern: /\bTRUNCATE\b/i,
  },
  {
    name: "ALTER COLUMN TYPE",
    // A type change rewrites the column under an ACCESS EXCLUSIVE lock (blocks readers and
    // writers on live data) and can lose data on a narrowing cast. Expand instead: add a new
    // column, backfill, migrate readers, drop later. Covers both `ALTER COLUMN x TYPE y` and
    // Drizzle's `ALTER COLUMN x SET DATA TYPE y`. Bounded to one statement ([^;]) so it cannot
    // span an ALTER COLUMN and an unrelated later CREATE TYPE.
    pattern: /\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/i,
  },
  {
    name: "DELETE FROM",
    // Row deletion mutates live data inside the deploy path. Data changes must be deliberate,
    // not a side effect of rolling code. `ON DELETE <action>` is a constraint clause, not this.
    pattern: /\bDELETE\s+FROM\b/i,
  },
  {
    name: "UPDATE",
    // A bulk UPDATE mutates live rows and can take heavy locks; backfills belong in a reviewed,
    // manually run step. The `ON UPDATE <action>` clause of a foreign key is neutralized before
    // matching, so constraint definitions do not trip this.
    pattern: /\bUPDATE\b/i,
  },
  {
    name: "SET NOT NULL",
    // Adding NOT NULL to an existing column validates every row under an ACCESS EXCLUSIVE lock
    // and fails outright if any row is null: lock-hazardous on live data. (Adding a new column
    // WITH NOT NULL DEFAULT is metadata-only and is not matched.)
    pattern: /\bSET\s+NOT\s+NULL\b/i,
  },
  {
    name: "REVOKE",
    // Removing a grant can break the other service's read-coupling contract (section 9): the
    // session service reads several API-owned tables. Withdrawing access is a contract phase.
    pattern: /\bREVOKE\b/i,
  },
];

// Files known to contain a reviewed, deliberately applied destructive statement. Each entry
// carries the justification it was reviewed under. Growing this list is the documented way to
// keep the stateless full-tree scan green after a manual contract migration lands.
export const ALLOWLIST = new Map([
  [
    "0001_real_schema.sql",
    "Bootstrap contract phase: `DROP TABLE _scaffold_marker CASCADE` removes the transient " +
      "scaffold table 0000 created, in the same initial migration. No live data exists at " +
      "bootstrap and the drop is journaled (idempotent), so it is not a live-data hazard. The " +
      "file is already applied to production and cannot be edited (Drizzle hashes applied " +
      "migrations). Grandfathered by review 2026-07-09.",
  ],
  [
    "0007_live_activity_tokens.sql",
    "Expand-only, but the guard's `UPDATE` rule matches the token `UPDATE` in the API's full-DML " +
      "grant (`GRANT SELECT, INSERT, UPDATE, DELETE ON live_activity_tokens TO crossy_api`), " +
      "which it cannot tell apart from a bulk DML UPDATE. This is the guard's known conservative " +
      "false positive on a GRANT privilege (the same shape 0001 carries for the original five " +
      "API-owned tables, green there only because 0001 is allowlisted). The file adds a table, " +
      "two FKs, an index, a CHECK, and read/write grants; it drops, renames, retypes, and " +
      "backfills nothing, so it is a genuine expand migration. The API needs the UPDATE " +
      "privilege for its ON CONFLICT DO UPDATE upsert on the token registry. Reviewed as " +
      "expand-only 2026-07-11.",
  ],
  [
    "0009_starter_features_backfill.sql",
    "Data-only backfill, deliberately riding the pipeline. The signup starter seed inserted " +
      "the starter puzzle without `features`, landing rows on the column default '{}'::jsonb, " +
      "which the iOS features twin cannot decode (it fails the caller's whole GET /puzzles " +
      "page). The UPDATE rewrites `features` on exactly those rows: `features = '{}'` plus the " +
      "starter's title/author, a predicate no ingested puzzle matches (ingestion always writes " +
      "detected features). A handful of rows, equality predicates, idempotent, no DDL, no lock " +
      "hazard. The schema is untouched; dropping the now-unused default is a separate " +
      "contract-phase migration. Reviewed 2026-07-11.",
  ],
]);

/**
 * Remove everything that must not be matched as SQL: line comments, block comments,
 * single-quoted string literals (with '' escapes), and the FK referential-action clauses
 * (ON DELETE / ON UPDATE ...). Dollar-quoted bodies (DO $$ ... $$) are NOT stripped: they hold
 * executable DDL, so a destructive statement hidden in a DO block must still be caught.
 */
export function stripNoise(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    // Line comment: -- ... to end of line.
    if (c === "-" && next === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i += 1;
      out += " ";
      continue;
    }
    // Block comment: /* ... */.
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
      continue;
    }
    // Single-quoted string literal, '' is an escaped quote.
    if (c === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    // Dollar-quoted block ($tag$ ... $tag$): copy the body through so its DDL is scanned.
    if (c === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tag) {
        const open = tag[0];
        const bodyStart = i + open.length;
        const end = sql.indexOf(open, bodyStart);
        out += " ";
        if (end === -1) {
          out += sql.slice(bodyStart);
          i = n;
        } else {
          out += sql.slice(bodyStart, end);
          out += " ";
          i = end + open.length;
        }
        continue;
      }
    }
    out += c;
    i += 1;
  }
  // Neutralize foreign-key referential actions so ON DELETE / ON UPDATE are never read as DML.
  return out.replace(
    /\bON\s+(?:DELETE|UPDATE)\s+(?:NO\s+ACTION|RESTRICT|CASCADE|SET\s+(?:NULL|DEFAULT))\b/gi,
    " ",
  );
}

/** Names of the deny-rules a single migration's SQL trips. */
export function scanSql(sql) {
  const cleaned = stripNoise(sql);
  return DENY_RULES.filter((rule) => rule.pattern.test(cleaned)).map(
    (rule) => rule.name,
  );
}

/**
 * Scan every .sql file in `dir`. Returns one entry per non-allowlisted file that trips a rule.
 */
export function scanMigrations(dir = DEFAULT_MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const violations = [];
  for (const file of files) {
    const rules = scanSql(readFileSync(join(dir, file), "utf8"));
    if (rules.length === 0) continue;
    if (ALLOWLIST.has(file)) continue;
    violations.push({ file, rules });
  }
  return violations;
}

/**
 * Read the Drizzle journal entries (`meta/_journal.json`), sorted by idx. Returns [] when the
 * folder has no journal, so the deny-list folder-scan tests (bare temp dirs) treat "no journal"
 * as "nothing to check".
 */
export function readJournalEntries(dir = DEFAULT_MIGRATIONS_DIR) {
  const path = join(dir, "meta", "_journal.json");
  if (!existsSync(path)) return [];
  const journal = JSON.parse(readFileSync(path, "utf8"));
  const entries = Array.isArray(journal.entries) ? [...journal.entries] : [];
  return entries.sort((a, b) => a.idx - b.idx);
}

/**
 * Journal `when` timestamps MUST be strictly increasing by idx. Drizzle's migrator applies a
 * migration only when its `when` (folderMillis) is GREATER than the single highest `created_at`
 * already recorded (`drizzle/node-postgres/migrator`), reading that high-water mark once. So a
 * later-idx migration stamped at or below an earlier one is SILENTLY SKIPPED on any database that
 * already recorded the earlier, higher stamp. A fresh database applies everything (no high-water
 * yet), so CI never sees it; only an existing database (production) does. Hand-edited round or
 * future `when` values are exactly this hazard: they poisoned the high-water mark here and silently
 * skipped 0009 and 0010 on production. Returns one entry per out-of-order migration.
 */
export function scanJournalOrder(dir = DEFAULT_MIGRATIONS_DIR) {
  const entries = readJournalEntries(dir);
  const violations = [];
  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (!(cur.when > prev.when)) {
      violations.push({
        tag: cur.tag,
        when: cur.when,
        prevTag: prev.tag,
        prevWhen: prev.when,
      });
    }
  }
  return violations;
}

function main() {
  const dir = DEFAULT_MIGRATIONS_DIR;
  const violations = scanMigrations(dir);
  const journalOrder = scanJournalOrder(dir);
  if (violations.length === 0 && journalOrder.length === 0) {
    console.log(
      `migration-guard: OK, no destructive statements and a monotonic journal in ${dir}`,
    );
    process.exit(0);
  }
  if (violations.length > 0) {
    console.error(
      "migration-guard: BLOCKED. A migration contains a destructive or lock-hazardous statement " +
        "that must not ride an auto push-to-main deploy:",
    );
    for (const v of violations) {
      console.error(`  ${v.file}: ${v.rules.join(", ")}`);
    }
    console.error(
      "\nExpand-only migrations ride the pipeline; contract/destructive changes are deliberate.\n" +
        "If this is a reviewed contract migration, apply it by hand: GitHub > Actions > Deploy >\n" +
        "Run workflow, set migrations_only=true and pick your branch (it applies migrations from\n" +
        "that ref and rolls nothing). Then add the file to ALLOWLIST in deploy/migration-guard.mjs\n" +
        "so later deploys pass. See deploy/README.md (Migrations + roles).",
    );
  }
  if (journalOrder.length > 0) {
    console.error(
      "migration-guard: BLOCKED. meta/_journal.json `when` timestamps are not strictly increasing\n" +
        "by idx. Drizzle applies a migration only when its `when` exceeds the highest already\n" +
        "recorded, so an out-of-order stamp is SILENTLY SKIPPED on an existing database (a fresh DB\n" +
        "applies everything, so CI stays green). Make the `when` values strictly increase; never\n" +
        "hand-edit them to round or future values. See deploy/README.md (Migrations + roles).",
    );
    for (const v of journalOrder) {
      console.error(
        `  ${v.tag} (when=${v.when}) must be greater than ${v.prevTag} (when=${v.prevWhen})`,
      );
    }
  }
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
