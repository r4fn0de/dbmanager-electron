#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const dbDir = join(root, 'src', 'ipc', 'db');

const ALLOWED_RAW_FILES = new Set([
  'pg-runtime.ts',
  'mysql-client.ts',
  'clickhouse-client.ts',
  'kysely-factory.ts',
  'local-db-manager.ts',
  'table-data-runtime.ts',
]);

const disallowedPatterns = [
  { name: 'direct-query', re: /\b(?:pool|client|conn)\.query\(/g },
  { name: 'new-pg-client', re: /\bnew\s+Client\s*\(/g },
];

const allFiles = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs);
    else if (st.isFile() && abs.endsWith('.ts')) allFiles.push(abs);
  }
}

walk(dbDir);

const violations = [];

for (const file of allFiles) {
  const base = file.split('/').pop();
  const rel = relative(root, file);
  const content = readFileSync(file, 'utf8');

  if (/pg-client/.test(content)) {
    violations.push(`${rel}: forbidden reference to pg-client`);
  }

  if (ALLOWED_RAW_FILES.has(base)) continue;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const p of disallowedPatterns) {
      if (p.re.test(lines[i])) {
        violations.push(`${rel}:${i + 1} forbidden ${p.name} usage`);
      }
      p.re.lastIndex = 0;
    }
  }
}

if (violations.length > 0) {
  console.error('\nDB boundary check failed:\n');
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}

console.log('DB boundary check passed');
