/**
 * Tests for the static SQL/RLS migration auditor
 * (scripts/verify-migrations.mjs) â€” positive fixtures (the real migration
 * files must pass) and negative fixtures (mutated SQL must be rejected with
 * the right violation).
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  auditMigrations,
  policyRoles,
  splitStatements,
  stripSqlComments,
} from '../../../scripts/verify-migrations.mjs'

interface AuditResult {
  ok: boolean
  violations: string[]
  policies: Array<{ name: string; table: string; statement: string }>
  tables: string[]
  fileSummaries: Array<{ file: string; statements: number }>
}

const audit = auditMigrations as (
  files: string[],
  opts?: { readFile?: (p: string) => string },
) => AuditResult
const split = splitStatements as (sql: string) => string[]
const strip = stripSqlComments as (sql: string) => string
const roles = policyRoles as (stmt: string) => string[]

const STACK_ROOT = join((import.meta as unknown as { dirname: string }).dirname, '..', '..', '..')
const MIGRATIONS_DIR = join(STACK_ROOT, 'supabase', 'migrations')

function realMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith('.sql'))
    .sort()
    .map((f: string) => join(MIGRATIONS_DIR, f))
}

const readFile = (p: string): string => readFileSync(p, 'utf8')

describe('SQL statement splitting', () => {
  it('does not treat semicolons inside string literals as separators', () => {
    const sql = "select 'a;b' as x;\nselect 2;"
    const statements = split(sql)
    expect(statements).toHaveLength(2)
    expect(statements[0]).toBe("select 'a;b' as x")
  })

  it('strips comments', () => {
    const sql = "-- a comment with ; semicolon\nselect 1; -- trailing"
    const statements = split(sql)
    expect(statements).toHaveLength(1)
  })

  it('keeps escaped single quotes intact', () => {
    expect(strip("select 'it''s;'")).toBe("select 'it''s;'")
  })
})

describe('policy role extraction', () => {
  it('reads the role target from a policy statement', () => {
    const stmt = 'create policy "p" on public.apps as permissive for select to authenticated using (auth.uid() = user_id)'
    expect(roles(stmt)).toEqual(['authenticated'])
  })

  it('flags missing role targets as empty', () => {
    const stmt = 'create policy "p" on public.apps for select using (true)'
    expect(roles(stmt)).toEqual([])
  })
})

describe('real migrations pass the audit (positive fixture)', () => {
  it('audits the committed migration files as OK', () => {
    const result = audit(realMigrationFiles(), { readFile })
    expect(result.violations).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.tables).toEqual(['apps'])
    expect(result.policies.map((p) => p.name)).toEqual([
      'apps_select_own',
      'apps_insert_own',
      'apps_update_own',
      'apps_delete_own',
    ])
  })

  it('finds exactly four owner-scoped policies and no anon grants', () => {
    const result = audit(realMigrationFiles(), { readFile })
    expect(result.policies).toHaveLength(4)
    for (const p of result.policies) {
      expect(roles(p.statement)).toEqual(['authenticated'])
      expect(p.statement).toMatch(/auth\.uid\(\)\s*=\s*user_id/i)
    }
  })
})

function auditSql(...files: Array<{ name: string; sql: string }>) {
  return audit(
    files.map((f) => f.name),
    { readFile: (p: string) => files.find((f) => f.name === p)!.sql },
  )
}

const MINIMAL_TABLE = `
create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint apps_user_id_name_key unique (user_id, name)
);
`

function fullPolicies(): string {
  return [
    `alter table public.apps enable row level security;`,
    `alter table public.apps force row level security;`,
    `create policy "apps_select_own" on public.apps as permissive for select to authenticated using (auth.uid() = user_id);`,
    `create policy "apps_insert_own" on public.apps as permissive for insert to authenticated with check (auth.uid() = user_id);`,
    `create policy "apps_update_own" on public.apps as permissive for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);`,
    `create policy "apps_delete_own" on public.apps as permissive for delete to authenticated using (auth.uid() = user_id);`,
    `create or replace function public.apps_set_updated_at() returns trigger language plpgsql as $fn$ begin new.updated_at = now(); return new; end; $fn$;`,
    `create trigger apps_set_updated_at before update on public.apps for each row execute function public.apps_set_updated_at();`,
  ].join('\n')
}

describe('negative fixtures (mutations must be rejected)', () => {
  const base = [
    { name: '001_table.sql', sql: MINIMAL_TABLE },
    { name: '002_policies.sql', sql: fullPolicies() },
  ]

  it('rejects a policy granted to anon', () => {
    const sql = fullPolicies().replace(
      'to authenticated using (auth.uid() = user_id);',
      'to anon using (true);',
    )
    const result = auditSql(...base.slice(0, 1), { name: '002_policies.sql', sql })
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('anon'))).toBe(true)
  })

  it('rejects a select policy without ownership scoping', () => {
    const sql = fullPolicies().replace('using (auth.uid() = user_id)', 'using (true)')
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    expect(result.violations.some((v) => v.includes('apps_select_own'))).toBe(true)
  })

  it('rejects an insert policy without WITH CHECK', () => {
    const sql = fullPolicies().replace(
      'for insert to authenticated with check (auth.uid() = user_id)',
      'for insert to authenticated',
    )
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    expect(result.violations.some((v) => v.includes('insert'))).toBe(true)
  })

  it('rejects an update policy that omits WITH CHECK', () => {
    const sql = fullPolicies().replace(
      'using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      'using (auth.uid() = user_id);',
    )
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    const updateViolations = result.violations.filter((v) => v.includes('(update)'))
    expect(updateViolations.some((v) => v.includes('WITH CHECK'))).toBe(true)
  })

  it('rejects RLS not enabled on a public table', () => {
    const sql = fullPolicies().replace(
      'alter table public.apps enable row level security;',
      '',
    )
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    expect(result.violations).toContain('table apps: RLS is not enabled')
  })

  it('rejects a policy with an implicit PUBLIC role target', () => {
    const sql = fullPolicies().replace(
      'create policy "apps_delete_own" on public.apps as permissive for delete to authenticated using (auth.uid() = user_id);',
      'create policy "apps_delete_own" on public.apps as permissive for delete using (auth.uid() = user_id);',
    )
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    expect(result.violations.some((v) => v.includes('no explicit role target'))).toBe(true)
  })

  it('rejects a GRANT to anon', () => {
    const sql = fullPolicies() + '\ngrant select on public.apps to anon;'
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    expect(result.violations.some((v) => v.includes('GRANT to anon'))).toBe(true)
  })

  it('rejects a GRANT to anon (including anon-executable functions)', () => {
    const sql =
      fullPolicies() +
      '\ngrant execute on function public.apps_set_updated_at() to anon;'
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    expect(result.violations.some((v) => v.includes('GRANT to anon'))).toBe(true)
  })

  it('rejects an unbalanced quote (parser safety)', () => {
    const sql = fullPolicies() + "\nselect 'oops;"
    const result = auditSql(base[0], { name: '002_policies.sql', sql })
    expect(result.violations.some((v) => v.includes('unbalanced single quotes'))).toBe(true)
  })
})
