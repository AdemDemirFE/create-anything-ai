/**
 * Mongoose connection management.
 *
 * Strictness posture (inherited from the Stack-18 document-store lesson):
 * - `strict: true`  — fields not present in a schema can never be persisted
 *   (unknown body fields are silently dropped by the driver layer).
 * - `strictQuery: true` — query filters are equally allow-listed per schema.
 * - On top of that, every route handler explicitly picks the fields it
 *   accepts from a request body (defense in depth: `parseCredentials`,
 *   `parseDocumentInput`), so no user-controlled key can ever reach the model.
 */
import mongoose from 'mongoose'

export async function connectMongo(uri: string, dbName?: string): Promise<typeof mongoose> {
  mongoose.set('strict', true)
  mongoose.set('strictQuery', true)
  return mongoose.connect(uri, { dbName })
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect()
}

export function connectionState(): number {
  return mongoose.connection.readyState
}
