/**
 * Apps data access (stack 08). All reads/writes go through supabase-js
 * `from('apps')`; Postgres RLS (see supabase/migrations) is the real
 * authorization layer — the client simply cannot address other users' rows,
 * and any attempt comes back as a PostgREST error (403 / 42501), normalized
 * to FORBIDDEN by the envelope layer.
 *
 * Every function returns the client-side envelope {ok,data,error,requestId}.
 */

import type { AppRow, AppStatus } from './database.types'
import { getSupabaseClient } from './supabase'
import {
  ErrorCodes,
  failureEnvelope,
  friendlyMessage,
  generateRequestId,
  mapPostgrestErrorCode,
  successEnvelope,
  type Envelope,
  type EnvelopeError,
} from './envelope'

const TABLE = 'apps' as const

export const MAX_NAME_LENGTH = 80
export const MAX_DESCRIPTION_LENGTH = 2_000

function postgrestErrorEnvelope(
  error: { message: string; code?: string | null; details?: string | null; hint?: string | null } | null,
  status: number,
): Envelope<never> {
  const code = mapPostgrestErrorCode(error?.code ?? undefined, status)
  return failureEnvelope(
    { code, message: friendlyMessage(code), status },
    generateRequestId(),
  )
}

function networkEnvelope(): Envelope<never> {
  return failureEnvelope(
    { code: ErrorCodes.Network, message: friendlyMessage(ErrorCodes.Network), status: 0 },
    generateRequestId(),
  )
}

export function validateAppInput(input: { name: string; description: string }): string | null {
  if (input.name.trim().length === 0) return 'Name is required.'
  if (input.name.length > MAX_NAME_LENGTH) return `Name must be at most ${MAX_NAME_LENGTH} characters.`
  if (input.description.length > MAX_DESCRIPTION_LENGTH) {
    return `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
  }
  return null
}

export async function listApps(): Promise<Envelope<AppRow[]>> {
  try {
    const { data, error, status } = await getSupabaseClient()
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return postgrestErrorEnvelope(error, status)
    return successEnvelope(data ?? [], generateRequestId())
  } catch {
    return networkEnvelope() as Envelope<AppRow[]>
  }
}

export async function getApp(id: string): Promise<Envelope<AppRow>> {
  if (!id) {
    return failureEnvelope(
      { code: ErrorCodes.Validation, message: 'Missing app id.', status: 0 },
      generateRequestId(),
    ) as Envelope<AppRow>
  }
  try {
    const { data, error, status } = await getSupabaseClient()
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) return postgrestErrorEnvelope(error, status)
    if (!data) {
      // Zero rows: either the id does not exist or RLS filtered it out
      // (someone else's app). Both are NOT_FOUND to this caller.
      return failureEnvelope(
        { code: ErrorCodes.NotFound, message: friendlyMessage(ErrorCodes.NotFound), status: 404 },
        generateRequestId(),
      ) as Envelope<AppRow>
    }
    return successEnvelope(data, generateRequestId())
  } catch {
    return networkEnvelope() as Envelope<AppRow>
  }
}

export async function createApp(
  insert: { name: string; description?: string; status?: AppStatus },
): Promise<Envelope<AppRow>> {
  const inputError = validateAppInput({
    name: insert.name,
    description: insert.description ?? '',
  })
  if (inputError) {
    return failureEnvelope(
      { code: ErrorCodes.Validation, message: inputError, status: 0 },
      generateRequestId(),
    ) as Envelope<AppRow>
  }
  try {
    const { data, error, status } = await getSupabaseClient()
      .from(TABLE)
      .insert({
        name: insert.name.trim(),
        description: (insert.description ?? '').trim(),
        status: insert.status ?? 'draft',
        // user_id is intentionally NOT sent: the insert policy's WITH CHECK
        // derives it from the JWT (auth.uid()). The Insert type marks it
        // optional for exactly this reason.
      })
      .select('*')
      .single()
    if (error) return postgrestErrorEnvelope(error, status)
    return successEnvelope(data, generateRequestId())
  } catch {
    return networkEnvelope() as Envelope<AppRow>
  }
}

export async function updateApp(
  id: string,
  update: { name?: string; description?: string; status?: AppStatus },
): Promise<Envelope<AppRow>> {
  if (!id) {
    return failureEnvelope(
      { code: ErrorCodes.Validation, message: 'Missing app id.', status: 0 },
      generateRequestId(),
    ) as Envelope<AppRow>
  }
  if (update.name !== undefined || update.description !== undefined) {
    const inputError = validateAppInput({
      name: update.name ?? 'x',
      description: update.description ?? '',
    })
    if (inputError) {
      return failureEnvelope(
        { code: ErrorCodes.Validation, message: inputError, status: 0 },
        generateRequestId(),
      ) as Envelope<AppRow>
    }
  }
  try {
    const { data, error, status } = await getSupabaseClient()
      .from(TABLE)
      .update({
        ...(update.name !== undefined ? { name: update.name.trim() } : {}),
        ...(update.description !== undefined ? { description: update.description.trim() } : {}),
        ...(update.status !== undefined ? { status: update.status } : {}),
      })
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) return postgrestErrorEnvelope(error, status)
    if (!data) {
      return failureEnvelope(
        { code: ErrorCodes.NotFound, message: friendlyMessage(ErrorCodes.NotFound), status: 404 },
        generateRequestId(),
      ) as Envelope<AppRow>
    }
    return successEnvelope(data, generateRequestId())
  } catch {
    return networkEnvelope() as Envelope<AppRow>
  }
}

export async function deleteApp(id: string): Promise<Envelope<null>> {
  if (!id) {
    return failureEnvelope(
      { code: ErrorCodes.Validation, message: 'Missing app id.', status: 0 },
      generateRequestId(),
    ) as Envelope<null>
  }
  try {
    const { error, status } = await getSupabaseClient().from(TABLE).delete().eq('id', id)
    if (error) return postgrestErrorEnvelope(error, status) as Envelope<null>
    return successEnvelope(null, generateRequestId())
  } catch {
    return networkEnvelope() as Envelope<null>
  }
}

export type { EnvelopeError }
