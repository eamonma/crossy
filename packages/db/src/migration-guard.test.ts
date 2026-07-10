/**
 * Expand-only migration guard (deploy/migration-guard.mjs) unit tests.
 *
 * The guard is the mechanical backstop for expand/contract migrations (DESIGN.md section 9;
 * INV-7): a destructive or lock-hazardous statement must never ride an auto push-to-main deploy
 * ahead of the roll. These tests defend that it (a) passes the real committed tree, (b) catches
 * each denied statement, including one hidden in a DO block, and (c) never trips on the SQL that
 * legitimate expand migrations contain (comments, string literals, FK referential actions).
 *
 * The guard is plain node and lives outside this package; it is imported here because the
 * migrations it guards live in this package, so packages/db's vitest suite is its natural home.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWLIST,
  DEFAULT_MIGRATIONS_DIR,
  scanMigrations,
  scanSql,
  stripNoise,
} from "../../../deploy/migration-guard.mjs";

describe("expand-only guard passes the committed tree (INV-7; DESIGN.md section 9)", () => {
  it("finds no destructive statement in the real packages/db/drizzle migrations", () => {
    // The whole point: 0000-0003 are expand-only (0001's scaffold DROP is grandfathered), so
    // the guard must be green today or the pipeline it gates is dead on arrival.
    expect(scanMigrations(DEFAULT_MIGRATIONS_DIR)).toEqual([]);
  });

  it("grandfathers 0001_real_schema.sql, whose scaffold DROP is a reviewed bootstrap (section 9)", () => {
    expect(ALLOWLIST.has("0001_real_schema.sql")).toBe(true);
  });
});

describe("guard catches denied statements (INV-7; DESIGN.md section 9 contract phase)", () => {
  it("flags each destructive or lock-hazardous form", () => {
    expect(scanSql('DROP TABLE "games";')).toContain("DROP");
    expect(scanSql('ALTER TABLE "games" DROP COLUMN "name";')).toContain(
      "DROP",
    );
    expect(
      scanSql('ALTER TABLE "games" RENAME COLUMN "name" TO "title";'),
    ).toContain("RENAME");
    expect(scanSql('TRUNCATE "cell_events";')).toContain("TRUNCATE");
    expect(
      scanSql('ALTER TABLE "games" ALTER COLUMN "name" TYPE varchar(80);'),
    ).toContain("ALTER COLUMN TYPE");
    expect(
      scanSql('ALTER TABLE "games" ALTER COLUMN "name" SET DATA TYPE text;'),
    ).toContain("ALTER COLUMN TYPE");
    expect(
      scanSql("DELETE FROM \"memberships\" WHERE role = 'spectator';"),
    ).toContain("DELETE FROM");
    expect(scanSql('UPDATE "games" SET "name" = \'x\';')).toContain("UPDATE");
    expect(
      scanSql('ALTER TABLE "games" ALTER COLUMN "name" SET NOT NULL;'),
    ).toContain("SET NOT NULL");
    expect(
      scanSql('REVOKE SELECT ON "games" FROM "crossy_session";'),
    ).toContain("REVOKE");
  });

  it("catches a destructive statement hidden inside a DO $$ block (no false negative)", () => {
    // DO bodies are executable DDL, so the guard must scan them, not treat them as literals.
    const sql = `DO $$ BEGIN
      DROP TABLE "cell_events";
    END $$;`;
    expect(scanSql(sql)).toContain("DROP");
  });
});

describe("guard does not trip on legitimate expand SQL (INV-7; DESIGN.md section 9)", () => {
  it("ignores keywords that appear only in comments", () => {
    expect(
      scanSql("-- this migration does NOT drop or delete from anything\n"),
    ).toEqual([]);
    expect(
      scanSql("/* a rename would be wrong here; we ADD instead */\n"),
    ).toEqual([]);
    // The word inside a comment must not leak into the scanned SQL.
    expect(stripNoise("-- DROP TABLE x\n").includes("DROP")).toBe(false);
  });

  it("ignores keywords that appear only inside string literals", () => {
    expect(
      scanSql('INSERT INTO "log" ("msg") VALUES (\'DELETE FROM everything\');'),
    ).toEqual([]);
    expect(
      scanSql('INSERT INTO "log" ("msg") VALUES (\'please do not TRUNCATE\');'),
    ).toEqual([]);
  });

  it("does not read a foreign-key ON DELETE / ON UPDATE clause as DML", () => {
    const fk =
      'ALTER TABLE "cell_events" ADD CONSTRAINT "fk" FOREIGN KEY ("user_id") ' +
      'REFERENCES "users"("user_id") ON DELETE cascade ON UPDATE no action;';
    expect(scanSql(fk)).toEqual([]);
  });

  it("passes the additive statements expand migrations are made of", () => {
    expect(scanSql('ALTER TABLE "games" ADD COLUMN "name" text;')).toEqual([]);
    expect(
      scanSql('ALTER TABLE "games" ADD COLUMN "n" integer NOT NULL DEFAULT 0;'),
    ).toEqual([]);
    expect(
      scanSql('CREATE INDEX IF NOT EXISTS "i" ON "memberships" ("user_id");'),
    ).toEqual([]);
    expect(scanSql('GRANT SELECT ON "games" TO "crossy_session";')).toEqual([]);
  });
});

describe("guard scans the folder and honors the allowlist (INV-7; DESIGN.md section 9)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "migration-guard-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports the offending file and the rules it tripped", () => {
    writeFileSync(
      join(dir, "0100_clean.sql"),
      'ALTER TABLE "games" ADD COLUMN "x" text;',
    );
    writeFileSync(join(dir, "0101_bad.sql"), 'DROP TABLE "games";');
    const violations = scanMigrations(dir);
    expect(violations).toEqual([{ file: "0101_bad.sql", rules: ["DROP"] }]);
  });

  it("skips a file whose name is in the allowlist even when it trips a rule", () => {
    // A reviewed contract migration applied via the manual escape hatch is added to ALLOWLIST
    // by filename; the stateless full-tree scan then stays green on later auto-deploys.
    writeFileSync(
      join(dir, "0001_real_schema.sql"),
      'DROP TABLE "_scaffold_marker" CASCADE;',
    );
    expect(scanMigrations(dir)).toEqual([]);
  });

  it("ignores non-.sql files in the folder", () => {
    writeFileSync(join(dir, "_journal.json"), '{ "note": "DROP TABLE x" }');
    expect(scanMigrations(dir)).toEqual([]);
  });
});
