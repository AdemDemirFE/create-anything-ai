/**
 * Allow-listed Mongoose models (document-store paradigm reused from Stack 18).
 *
 * Each schema is a hard allow-list: only the fields declared below exist on
 * the persisted documents. With `strict: true` (set in db.ts) any other key
 * supplied by a client is dropped before it can reach storage, and the
 * public projections whitelist exactly the fields the API returns —
 * `passwordHash` and `tokenHash` can never appear in a response.
 *
 * Models are registered idempotently because the vitest suite re-evaluates
 * this module per test file (Stack-18 lesson).
 */
import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose'

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      // Bounded, per the storage contract; format is validated at the API.
      maxLength: 254,
    },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
)

const sessionSchema = new Schema(
  {
    // Only the SHA-256 digest of the session token is stored; the raw token
    // lives exclusively in the client's HttpOnly cookie.
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)
// TTL index: MongoDB removes expired sessions on its background sweep.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const documentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxLength: 200 },
    content: { type: String, required: true, maxLength: 10_000 },
    tags: {
      type: [String],
      required: false,
      default: [],
      validate: {
        validator: (tags: string[]) => tags.length <= 10,
        message: 'At most 10 tags are allowed.',
      },
    },
  },
  { timestamps: true },
)
documentSchema.index({ userId: 1, updatedAt: -1 })

export interface UserFields {
  email: string
  passwordHash: string
  createdAt?: Date
  updatedAt?: Date
}

export interface SessionFields {
  tokenHash: string
  userId: Schema.Types.ObjectId
  expiresAt: Date
  createdAt?: Date
  updatedAt?: Date
}

export interface DocumentFields {
  userId: Schema.Types.ObjectId
  title: string
  content: string
  tags?: string[]
  createdAt?: Date
  updatedAt?: Date
}

export type UserDoc = HydratedDocument<UserFields> & { _id: Schema.Types.ObjectId }
export type SessionDoc = HydratedDocument<SessionFields> & { _id: Schema.Types.ObjectId }
export type DocumentDoc = HydratedDocument<DocumentFields> & { _id: Schema.Types.ObjectId }

/**
 * Register models idempotently: vitest re-evaluates this module per test
 * file, and Mongoose refuses to re-register the same model name.
 */
function registerModel(name: string, schema: Schema): Model<unknown> {
  return mongoose.models[name] ?? mongoose.model(name, schema)
}

export const User = registerModel('User', userSchema)
export const Session = registerModel('Session', sessionSchema)
export const StackDocument = registerModel('Document', documentSchema)

/** Public user projection — the ONLY shape ever returned for a user. */
export function toPublicUser(user: UserDoc): { id: string; email: string } {
  return { id: String(user._id), email: user.email }
}

/** Public document projection — never exposes internals, only allow-listed fields. */
export function toPublicDocument(doc: DocumentDoc): {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
} {
  return {
    id: String(doc._id),
    title: doc.title,
    content: doc.content,
    tags: [...(doc.tags ?? [])],
    createdAt: (doc.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date(0)).toISOString(),
  }
}
