/**
 * Explicit request-body validation with allow-listed field picking.
 *
 * The API accepts exactly the fields declared here. Unknown keys are never
 * forwarded to the model layer (defense in depth on top of Mongoose strict
 * mode) and validation errors come back as field-level details in the
 * envelope.
 *
 * Password policy mirrors the other reference stacks: minimum 10 characters.
 * Test literals are plain dictionary-type strings (no leetspeak — GG
 * lesson: obfuscated test fixtures look like real secrets to scanners).
 *
 * Email normalization note (Stack-15 mixed-case lesson): the ROUTE is
 * responsible for trimming/lowercasing BEFORE the uniqueness pre-check, so
 * the value checked against the unique index is exactly the value stored —
 * mixed-case input can never slip past the pre-check and blow up as an
 * E11000 500 later.
 */
export const MIN_PASSWORD_LENGTH = 10
export const MAX_EMAIL_LENGTH = 254
export const MAX_TITLE_LENGTH = 200
export const MAX_CONTENT_LENGTH = 10_000
export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 32

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface FieldIssue {
  field: string
  code: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string'
}

export interface Credentials {
  email: string
  password: string
}

/** Picks {email, password} and validates; returns issues instead of throwing. */
export function parseCredentials(body: unknown): { value?: Credentials; issues: FieldIssue[] } {
  const issues: FieldIssue[] = []
  const source = (body ?? {}) as Record<string, unknown>
  const emailRaw = source.email
  const passwordRaw = source.password

  if (!isNonEmptyString(emailRaw) || emailRaw.trim().length === 0) {
    issues.push({ field: 'email', code: 'REQUIRED' })
  } else if (emailRaw.length > MAX_EMAIL_LENGTH) {
    issues.push({ field: 'email', code: 'TOO_LONG' })
  } else if (!EMAIL_PATTERN.test(emailRaw)) {
    issues.push({ field: 'email', code: 'INVALID_FORMAT' })
  }

  if (!isNonEmptyString(passwordRaw)) {
    issues.push({ field: 'password', code: 'REQUIRED' })
  } else if (passwordRaw.length < MIN_PASSWORD_LENGTH) {
    issues.push({ field: 'password', code: 'TOO_SHORT' })
  } else if (passwordRaw.length > 128) {
    issues.push({ field: 'password', code: 'TOO_LONG' })
  }

  if (issues.length > 0) return { issues }
  return { value: { email: emailRaw as string, password: passwordRaw as string }, issues }
}

export interface DocumentInput {
  title: string
  content: string
  tags: string[]
}

/** Picks allow-listed document fields {title, content, tags} and validates. */
export function parseDocumentInput(
  body: unknown,
  { partial = false }: { partial?: boolean } = {},
): { value?: Partial<DocumentInput>; issues: FieldIssue[] } {
  const issues: FieldIssue[] = []
  const source = (body ?? {}) as Record<string, unknown>
  const value: Partial<DocumentInput> = {}

  const titleRaw = source.title
  if (titleRaw === undefined && partial) {
    // Field omitted on a partial update — fine.
  } else if (!isNonEmptyString(titleRaw) || titleRaw.trim().length === 0) {
    issues.push({ field: 'title', code: 'REQUIRED' })
  } else if (titleRaw.length > MAX_TITLE_LENGTH) {
    issues.push({ field: 'title', code: 'TOO_LONG' })
  } else {
    value.title = titleRaw.trim()
  }

  const contentRaw = source.content
  if (contentRaw === undefined && partial) {
    // Field omitted on a partial update — fine.
  } else if (!isNonEmptyString(contentRaw) || contentRaw.length === 0) {
    issues.push({ field: 'content', code: 'REQUIRED' })
  } else if (contentRaw.length > MAX_CONTENT_LENGTH) {
    issues.push({ field: 'content', code: 'TOO_LONG' })
  } else {
    value.content = contentRaw
  }

  const tagsRaw = source.tags
  if (tagsRaw !== undefined) {
    if (!Array.isArray(tagsRaw) || tagsRaw.some((tag) => !isNonEmptyString(tag))) {
      issues.push({ field: 'tags', code: 'INVALID_FORMAT' })
    } else if (tagsRaw.length > MAX_TAGS) {
      issues.push({ field: 'tags', code: 'TOO_MANY' })
    } else if (tagsRaw.some((tag) => tag.length > MAX_TAG_LENGTH)) {
      issues.push({ field: 'tags', code: 'TOO_LONG' })
    } else {
      value.tags = tagsRaw
    }
  }

  if (issues.length > 0) return { issues }
  return { value, issues }
}

/** Pagination bounds for the document list endpoint. */
export function parsePagination(query: Record<string, unknown>): { page: number; limit: number; issues: FieldIssue[] } {
  const issues: FieldIssue[] = []
  const pageRaw = query.page
  const limitRaw = query.limit
  let page = 1
  let limit = 20

  if (pageRaw !== undefined) {
    const parsed = Number.parseInt(String(pageRaw), 10)
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10_000) {
      issues.push({ field: 'page', code: 'INVALID' })
    } else {
      page = parsed
    }
  }
  if (limitRaw !== undefined) {
    const parsed = Number.parseInt(String(limitRaw), 10)
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
      issues.push({ field: 'limit', code: 'INVALID' })
    } else {
      limit = parsed
    }
  }
  return { page, limit, issues }
}

/**
 * Email normalization shared by register and login (Stack-15 mixed-case
 * lesson): trim + lowercase BEFORE any uniqueness lookup, so the value
 * checked is exactly the value stored and later looked up.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
