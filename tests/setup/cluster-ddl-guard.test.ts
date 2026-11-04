import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Cluster-wide catalogs (roles, databases, extensions) are shared by every test run on the server.
// Any test file that runs such DDL must take the cluster lock (withClusterLock), or it can fail with
// "tuple concurrently updated" when two runs overlap. This guard lists every file that contains such
// SQL and fails if the file does not use withClusterLock. Files listed in ALLOWED are exceptions,
// each with the reason it cannot change cluster state.

const ROOT = path.resolve(__dirname, '../..');
const CLUSTER_DDL = /\b(ALTER\s+ROLE|CREATE\s+ROLE|DROP\s+ROLE|GRANT\s+\S|REVOKE\s+\S|CREATE\s+EXTENSION|CREATE\s+DATABASE|DROP\s+DATABASE)\b/;
const SELF = 'tests/setup/cluster-ddl-guard.test.ts';

const ALLOWED: Record<string, string> = {
  'tests/setup/create-database.test.ts': 'CREATE DATABASE appears only as a string passed to a stub client; no server call',
  'tests/security/privileges.test.ts': 'CREATE ROLE runs as food_app_login and is expected to be denied; the transaction is rolled back',
};

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('cluster-wide DDL in tests runs under the cluster lock', () => {
  const files = walk(path.join(ROOT, 'tests'), []).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));

  it('finds the cluster-wide statements it is meant to check', () => {
    const hits = files.filter((f) => f !== SELF && CLUSTER_DDL.test(readFileSync(path.join(ROOT, f), 'utf8')));
    expect(hits).toEqual(expect.arrayContaining(['tests/helpers/db.ts', 'tests/setup/create-database.ts']));
  });

  it('every file with cluster-wide DDL imports and calls withClusterLock, or is an allowed exception', () => {
    const unlocked: string[] = [];
    for (const rel of files) {
      if (rel === SELF || ALLOWED[rel]) continue;
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      if (!CLUSTER_DDL.test(src)) continue;
      const locked = /import\s*\{[^}]*\bwithClusterLock\b[^}]*\}\s*from/.test(src) && /\bwithClusterLock\s*\(/.test(src);
      if (!locked) unlocked.push(rel);
    }
    expect(unlocked).toEqual([]);
  });

  it('every allowed exception still contains cluster-wide DDL (the list does not go stale)', () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(CLUSTER_DDL.test(readFileSync(path.join(ROOT, rel), 'utf8')), rel).toBe(true);
    }
  });
});
