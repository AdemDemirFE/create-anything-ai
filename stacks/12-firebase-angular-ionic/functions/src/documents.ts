/**
 * Firestore data access for documents (owner-scoped CRUD).
 *
 * Rules mirror (and Firestore security rules enforce at the emulator, see
 * firestore.rules): a document lives at users/{uid}/documents/{docId}; the
 * owner uid comes from the VERIFIED session, never from the request body.
 */
import { randomUUID } from 'node:crypto'
import { getFirestore } from 'firebase-admin/firestore'
import { ApiError } from './envelope.js'
import { ErrorCodes } from './error-codes.js'
import { COLLECTIONS, config } from './config.js'
import type { SessionUser } from './session.js'

export interface DocumentDto {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

interface DocumentRecord {
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

function assertBoundedTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(422, ErrorCodes.Validation, 'title must be a string.')
  const title = raw.trim()
  if (title.length === 0) throw new ApiError(422, ErrorCodes.Validation, 'title must not be empty.')
  if (title.length > config.bounds.maxTitleLength) {
    throw new ApiError(413, ErrorCodes.InputTooLarge, `title exceeds ${config.bounds.maxTitleLength} characters.`)
  }
  return title
}

function assertBoundedContent(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(422, ErrorCodes.Validation, 'content must be a string.')
  if (raw.length > config.bounds.maxContentLength) {
    throw new ApiError(413, ErrorCodes.InputTooLarge, `content exceeds ${config.bounds.maxContentLength} characters.`)
  }
  return raw
}

function toDto(id: string, rec: DocumentRecord): DocumentDto {
  return { id, title: rec.title, content: rec.content, createdAt: rec.createdAt, updatedAt: rec.updatedAt }
}

export async function createDocument(user: SessionUser, body: unknown): Promise<DocumentDto> {
  const b = (body ?? {}) as { title?: unknown; content?: unknown }
  const title = assertBoundedTitle(b.title)
  const content = assertBoundedContent(b.content)
  const now = new Date().toISOString()
  const id = randomUUID()
  const rec: DocumentRecord = { title, content, createdAt: now, updatedAt: now }
  await getFirestore()
    .collection(COLLECTIONS.users)
    .doc(user.uid)
    .collection(COLLECTIONS.documents)
    .doc(id)
    .create(rec)
  return toDto(id, rec)
}

export async function listDocuments(user: SessionUser, pageRaw: unknown, limitRaw: unknown): Promise<{ documents: DocumentDto[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const page = clampInt(pageRaw, 1, 1, 10_000)
  const limit = clampInt(limitRaw, 20, 1, 100)
  const col = getFirestore().collection(COLLECTIONS.users).doc(user.uid).collection(COLLECTIONS.documents)
  const totalSnap = await col.count().get()
  const total = totalSnap.data().count
  const snap = await col
    .orderBy('createdAt', 'desc')
    .orderBy('__name__', 'desc')
    .offset((page - 1) * limit)
    .limit(limit)
    .get()
  const documents = snap.docs.map((d) => toDto(d.id, d.data() as DocumentRecord))
  return { documents, pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } }
}

export async function getDocument(user: SessionUser, id: unknown): Promise<DocumentDto> {
  const ref = getFirestore().collection(COLLECTIONS.users).doc(user.uid).collection(COLLECTIONS.documents).doc(assertId(id))
  const snap = await ref.get()
  if (!snap.exists) throw new ApiError(404, ErrorCodes.NotFound, 'Document not found.')
  return toDto(snap.id, snap.data() as DocumentRecord)
}

export async function updateDocument(user: SessionUser, id: unknown, body: unknown): Promise<DocumentDto> {
  const b = (body ?? {}) as { title?: unknown; content?: unknown }
  const ref = getFirestore().collection(COLLECTIONS.users).doc(user.uid).collection(COLLECTIONS.documents).doc(assertId(id))
  const snap = await ref.get()
  if (!snap.exists) throw new ApiError(404, ErrorCodes.NotFound, 'Document not found.')
  const prev = snap.data() as DocumentRecord
  const title = b.title === undefined ? prev.title : assertBoundedTitle(b.title)
  const content = b.content === undefined ? prev.content : assertBoundedContent(b.content)
  const updatedAt = new Date().toISOString()
  await ref.update({ title, content, updatedAt })
  return toDto(snap.id, { title, content, createdAt: prev.createdAt, updatedAt })
}

export async function deleteDocument(user: SessionUser, id: unknown): Promise<void> {
  const ref = getFirestore().collection(COLLECTIONS.users).doc(user.uid).collection(COLLECTIONS.documents).doc(assertId(id))
  const snap = await ref.get()
  if (!snap.exists) throw new ApiError(404, ErrorCodes.NotFound, 'Document not found.')
  await ref.delete()
}

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !/^[0-9a-fA-F-]{1,64}$/.test(id)) {
    throw new ApiError(422, ErrorCodes.Validation, 'Invalid document id.')
  }
  return id
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'string' && typeof raw !== 'number') return fallback
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return Math.trunc(n)
}
