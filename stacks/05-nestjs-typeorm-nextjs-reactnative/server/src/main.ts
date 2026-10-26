/**
 * Bootstrap: standalone Nest HTTP server. The same AppModule (via
 * createApp in testing/app.module) powers the supertest suite.
 */
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ConfigService } from '@nestjs/config'
import { AppModule, configureExpress } from './app.module.js'
import { DEFAULT_PORT } from './app-config.js'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  const config = app.get(ConfigService)
  configureExpress(app, config)
  app.setGlobalPrefix('api/v1')

  const port = Number.parseInt(process.env['PORT'] ?? '', 10) || DEFAULT_PORT
  await app.listen(port, '0.0.0.0')
  // eslint-disable-next-line no-console
  console.log(`stack05 server listening on http://localhost:${port}/api/v1`)
}

void bootstrap()
