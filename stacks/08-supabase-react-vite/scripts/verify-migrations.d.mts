/**
 * Type declarations for verify-migrations.mjs so the auditor can be imported
 * from TypeScript tests (web/tsconfig.json has allowJs disabled). Keep these
 * in sync with the exported signatures in verify-migrations.mjs.
 */
export interface AuditResult {
  ok: boolean
  violations: string[]
  policies: Array<{ name: string; table: string; statement: string }>
  tables: string[]
  fileSummaries: Array<{ file: string; statements: number }>
}

export interface AuditOptions {
  readFile?: (path: string) => string
}

export const MIGRATIONS_DIR_DEFAULT: string

export function stripSqlComments(sql: string): string
export function splitStatements(sql: string): string[]
export function parsePolicies(statements: string[]): Array<{
  name: string
  table: string
  statement: string
}>
export function parseTables(statements: string[]): string[]
export function policyRoles(stmt: string): string[]
export function auditMigrations(files: string[], opts?: AuditOptions): AuditResult
export function runCli(argv?: string[]): AuditResult
