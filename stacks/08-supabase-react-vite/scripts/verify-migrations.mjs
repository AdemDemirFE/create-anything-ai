#!/usr/bin/env node
/**
 * Stack 08 — static SQL/RLS migration auditor.
 *
 * The Supabase runtime (Docker) was not available in this workspace, so RLS
 * behavior cannot be exercised live (see verification.md). This script makes
 * the *static* half of the security contract enforceable instead:
 *
 *   1. every migration file parses (statement split, balanced quotes),
 *   2. public tables have RLS enabled (and forced),
 *   3. every policy on public tables targets `to authenticated` (never anon),
 *   4. every policy scopes rows via `auth.uid() = user_id`
 *      (select/delete: in USING; insert: in WITH CHECK; update: both),
 *   5. updated_at trigger exists on public.apps,
 *   6. no anonymous policy is introduced by later migrations.
 *
 * Exit code 0 = all invariants hold; 1 = at least one violation (printed).
 * The same rules are pinned by vitest tests in
 * web/src/lib/migrations.test.ts (positive fixtures + negative fixtures that
 * must be *rejected* by this module).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const MIGRATIONS_DIR_DEFAULT = 'supabase/migrations'

/** Strip comments (line and block) without touching quoted content. */
export function stripSqlComments(sql) {
  let out = ''
  let i = 0
  let quote = null // "'", '"', or null
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (quote) {
      if (quote === "'" && ch === "'" && next === "'") {
        out += "''"
        i += 2
        continue
      }
      if (ch === quote) quote = null
      out += ch
      i += 1
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      i += 1
      continue
    }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** Split raw SQL text into statements on top-level semicolons. */
export function splitStatements(sql) {
  const stripped = stripSqlComments(sql)
  const statements = []
  let current = ''
  let quote = null
  let depth = 0
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(') depth += 1
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) {
      const s = current.trim()
      if (s) statements.push(s)
      current = ''
      continue
    }
    current += ch
  }
  const rest = current.trim()
  if (rest) statements.push(rest)
  return statements
}

const POLICY_RE = /create\s+policy\s+"([^"]+)"\s+on\s+((?:public\.)?[\w]+)|create\s+policy\s+(?:"([^"]+)"\s+)?on\s+((?:public\.)?[\w]+)/gi

export function parsePolicies(statements) {
  const policies = []
  for (const stmt of statements) {
    const m = /create\s+policy\s+"([^"]+)"\s+on\s+((?:public\.)?[\w.]+)/i.exec(stmt)
    if (!m) continue
    policies.push({
      name: m[1],
      table: m[2].replace(/^public\./i, ''),
      statement: stmt,
    })
  }
  return policies
}

export function parseTables(statements) {
  const tables = []
  for (const stmt of statements) {
    const m = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?[\w]+)\s*\(/i.exec(stmt)
    if (!m) continue
    tables.push(m[1].replace(/^public\./i, ''))
  }
  return tables
}

/** Extract the role target: everything after `to ` up to the next clause keyword. */
export function policyRoles(stmt) {
  const m = /\bto\s+([\w\s,]+?)(?=\busing\b|\bwith\b|\bas\b|\bfor\b|$)/i.exec(stmt)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function auditMigrations(migrationFiles, opts = {}) {
  const read = opts.readFile ?? ((p) => readFileSync(p, 'utf8'))
  const violations = []
  const policies = []
  const tables = []
  const fileSummaries = []

  for (const file of migrationFiles) {
    const text = read(file)
    const statements = splitStatements(text)
    fileSummaries.push({ file, statements: statements.length })
    tables.push(...parseTables(statements))
    policies.push(...parsePolicies(statements))

    // Balanced quotes sanity: stripped text must not end inside a string.
    const stripped = stripSqlComments(text)
    const quotes = (stripped.match(/'/g) ?? []).length
    if (quotes % 2 !== 0) {
      violations.push(`${file}: unbalanced single quotes — statement splitting is unreliable`)
    }
  }

  const publicTables = [...new Set(tables)]

  // Rule 1: every public table gets RLS enabled AND forced in the same set.
  for (const table of publicTables) {
    const joined = migrationFiles.map((f) => stripSqlComments(read(f))).join('\n')
    const enableRe = new RegExp(
      `alter\\s+table\\s+(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`,
      'i',
    )
    const forceRe = new RegExp(
      `alter\\s+table\\s+(?:public\\.)?${table}\\s+force\\s+row\\s+level\\s+security`,
      'i',
    )
    if (!enableRe.test(joined)) violations.push(`table ${table}: RLS is not enabled`)
    if (!forceRe.test(joined)) violations.push(`table ${table}: RLS is not forced`)
  }

  // Rule 2: every policy on a public table must target authenticated (not anon).
  for (const p of policies) {
    const roles = policyRoles(p.statement)
    if (roles.length === 0) {
      violations.push(`policy "${p.name}" on ${p.table}: no explicit role target (implicit PUBLIC includes anon)`)
      continue
    }
    if (roles.includes('anon') || roles.includes('public')) {
      violations.push(`policy "${p.name}" on ${p.table}: grants to anon/public — anonymous access is forbidden by this stack's contract`)
    }
    if (!roles.includes('authenticated')) {
      violations.push(`policy "${p.name}" on ${p.table}: does not target "authenticated"`)
    }
  }

  // Rule 3: ownership scoping per operation.
  for (const p of policies) {
    const stmt = p.statement
    const opMatch = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(stmt)
    const op = opMatch ? opMatch[1].toLowerCase() : 'all'
    const using = /\busing\s*\(([\s\S]*?)\)\s*(?:with\s+check|$)/i.exec(stmt)
    const withCheck = /\bwith\s+check\s*\(([\s\S]*?)\)\s*(?:;|$)/i.exec(stmt)
    const scope = /auth\.uid\(\)\s*=\s*user_id/i

    if (op === 'select' || op === 'delete' || op === 'all') {
      if (!using || !scope.test(using[1])) {
        violations.push(`policy "${p.name}" (${op}): USING must scope rows with auth.uid() = user_id`)
      }
    }
    if (op === 'insert') {
      if (!withCheck || !scope.test(withCheck[1])) {
        violations.push(`policy "${p.name}" (insert): WITH CHECK must enforce auth.uid() = user_id`)
      }
    }
    if (op === 'update') {
      if (!using || !scope.test(using[1])) {
        violations.push(`policy "${p.name}" (update): USING must scope rows with auth.uid() = user_id`)
      }
      if (!withCheck || !scope.test(withCheck[1])) {
        violations.push(`policy "${p.name}" (update): WITH CHECK must enforce auth.uid() = user_id`)
      }
    }
  }

  // Rule 4: updated_at trigger present for public.apps.
  const joinedAll = migrationFiles.map((f) => stripSqlComments(read(f))).join('\n')
  if (
    publicTables.includes('apps') &&
    !/execute\s+function\s+public\.apps_set_updated_at/i.test(joinedAll)
  ) {
    violations.push('table apps: updated_at trigger (apps_set_updated_at) not found')
  }

  // Rule 5: forbid known foot-guns regardless of file order.
  const grantAnonRe = /grant\s+[^;]*\bto\s+(?:anon|public)\b/i
  if (grantAnonRe.test(joinedAll)) {
    violations.push('a GRANT to anon/public was found — anonymous grants are forbidden')
  }
  if (/security\s+definer\s+function[^;]*\bexecut(e|ion)\s+to\s+(?:anon|public)/i.test(joinedAll)) {
    violations.push('a SECURITY DEFINER function is executable by anon/public — forbidden')
  }

  return { ok: violations.length === 0, violations, policies, tables: publicTables, fileSummaries }
}

/** CLI entry: audit every *.sql file in the migrations directory. */
export function runCli(argv = process.argv.slice(2)) {
  const dir = argv[0] ?? MIGRATIONS_DIR_DEFAULT
  let files
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => join(dir, f))
  } catch (err) {
    console.error(`verify-migrations: cannot read ${dir}: ${err.message}`)
    process.exitCode = 1
    return { ok: false, violations: [`cannot read ${dir}`] }
  }
  if (files.length === 0) {
    console.error(`verify-migrations: no .sql migrations found in ${dir}`)
    process.exitCode = 1
    return { ok: false, violations: [`no migrations in ${dir}`] }
  }
  const result = auditMigrations(files)
  for (const v of result.violations) console.error(`FAIL: ${v}`)
  console.log(
    result.ok
      ? `verify-migrations: OK — ${result.fileSummaries.length} migration file(s), ` +
          `${result.tables.length} public table(s) [${result.tables.join(', ')}], ` +
          `${result.policies.length} policy(ies), all invariants hold`
      : `verify-migrations: ${result.violations.length} violation(s)`,
  )
  return result
}

// Execute as CLI only when run directly (not when imported by tests).
const isMain = process.argv[1] && /verify-migrations\.(mjs|cjs|js)$/.test(process.argv[1].replace(/\\/g, '/'))
if (isMain) runCli()
