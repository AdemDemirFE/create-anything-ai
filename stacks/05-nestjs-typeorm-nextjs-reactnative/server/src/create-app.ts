/**
 * Test/bootstrap helper: builds the FULL AppModule as a Nest INestApplication
 * with cookie parsing + CORS + global prefix wired exactly like main.ts, so
 * supertest exercises the real HTTP stack over a REAL sqlite database.
 */
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule, configureExpress } from './app.module.js'

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] })
  const config = app.get(ConfigService)
  configureExpress(app, config)
  app.setGlobalPrefix('api/v1')
  await app.init()
  return app
}
