/**
 * Quick boot check: initializes the AppModule standalone (used by the
 * smoke script and for local debugging; NOT part of the test suite).
 */
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { ConfigService } from '@nestjs/config'
import { AppModule, configureExpress } from './app.module.js'

export async function boot(port: number): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] })
  const config = app.get(ConfigService)
  configureExpress(app, config)
  app.setGlobalPrefix('api/v1')
  await app.listen(port, '127.0.0.1')
  return app
}

process.on('unhandledRejection', (err) => {
  // eslint-disable-next-line no-console
  console.error('unhandled rejection:', err)
  process.exit(1)
})

const port = Number.parseInt(process.env['PORT'] ?? '', 10) || 4000
void boot(port)
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`ready on http://127.0.0.1:${port}/api/v1`)
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('boot failed:', err)
    process.exit(1)
  })
