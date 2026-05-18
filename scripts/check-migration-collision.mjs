#!/usr/bin/env node

import { readdirSync } from "fs";
import { execSync } from "child_process";
import { existsSync, appendFileSync } from "fs";
import { join } from "path";

const MIGRATION_DIR = "supabase/migrations";
const SHAPE_RE = /^\d{14}_.+\.sql$/;
const SKIP_FLAG = process.argv.includes("--skip-collision-check");

if (SKIP_FLAG) {
  const banner = "WARNING: SKIPPING LEDGER CHECK — collision detection bypassed by operator.";
  console.warn(`\n${"=".repeat(banner.length)}\n${banner}\n${"=".repeat(banner.length)}\n`);
  const logPath = join(process.cwd(), ".migration-check.log");
  appendFileSync(logPath, `${new Date().toISOString()} SKIP override by operator\n`);
  process.exit(0);
}

if (!existsSync(MIGRATION_DIR)) {
  console.log("No supabase/migrations/ directory — nothing to check.");
  process.exit(0);
}

const files = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.log("No .sql files in supabase/migrations/ — nothing to check.");
  process.exit(0);
}

for (const f of files) {
  if (!SHAPE_RE.test(f)) {
    console.error(`HALT: malformed migration filename: ${f}`);
    console.error("Expected pattern: <14-digit-timestamp>_<slug>.sql");
    process.exit(1);
  }
}

function slugOf(filename) {
  const base = filename.replace(/\.sql$/, "");
  return base.slice(15); // drop "YYYYMMDDHHMMSS_"
}

let ledgerRows;
try {
  const raw = execSync(
    `supabase db query --linked "SELECT version, name FROM supabase_migrations.schema_migrations"`,
    { timeout: 15_000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  const jsonMatch = raw.match(/\{[\s\S]*"rows"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    ledgerRows = parsed.rows || [];
  } else {
    ledgerRows = [];
    const lines = raw.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      const match = line.match(/^\s*(\d{14})\s*\|\s*(.+?)\s*$/);
      if (match) {
        ledgerRows.push({ version: match[1], name: match[2] });
      }
    }
  }
  if (ledgerRows.length === 0) {
    console.error(
      "HALT: ledger query returned zero parseable rows. This contradicts known applied migrations."
    );
    console.error("Check: correct project linked? Auth valid? Run: supabase projects list");
    process.exit(1);
  }
} catch (err) {
  console.error(`COULD NOT VERIFY LEDGER: ${err.message}`);
  console.error("Re-run with --skip-collision-check to override.");
  console.error("Remediation: check network, run 'supabase login' and 'supabase link --project-ref pbgvgjjuhnpsumnowuym'");
  process.exit(1);
}

const ledgerMap = new Map(ledgerRows.map((r) => [r.version, r.name]));
let alreadyInLedger = 0;
let collisions = 0;

for (const f of files) {
  const version = f.slice(0, 14);
  const localSlug = slugOf(f);
  const ledgerName = ledgerMap.get(version);
  if (ledgerName !== undefined) {
    alreadyInLedger++;
    if (ledgerName !== localSlug) {
      console.error(
        `COLLISION: local file '${f}' at timestamp ${version}, but prod ledger has a different migration name '${ledgerName}' at that version.`
      );
      console.error("Rename your file to the next free timestamp.");
      collisions++;
    }
  }
}

if (collisions > 0) {
  process.exit(1);
}

console.log(
  `Ledger check OK. ${files.length} local migrations, ${alreadyInLedger} already in ledger, no collisions.`
);
process.exit(0);
