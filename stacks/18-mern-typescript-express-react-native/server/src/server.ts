/**
 * Entry point: connects MongoDB, then starts listening. Tests never import
 * this file — they use the app factory with mongodb-memory-server.
 */
import { connectMongo } from './db.js'
import { createApp } from './app.js'

async function main(): Promise<void> {
  const { app, config, bcryptPool } = createApp()
  await connectMongo(config.mongoUri)
  const server = app.listen(config.port, () => {
    process.stdout.write(`Stack 18 server listening on port ${config.port}\n`)
  })
  const shutdown = async (): Promise<void> => {
    server.close()
    await bcryptPool.dispose()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void main().catch((err) => {
  process.stderr.write(`Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
