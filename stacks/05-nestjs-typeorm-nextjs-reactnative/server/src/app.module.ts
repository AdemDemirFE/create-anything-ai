/**
 * AppModule — the composition root. TypeORM runs on better-sqlite3
 * (synchronize for the reference; production swaps the driver + migrations).
 * Global pipes/interceptors/filters wire the envelope contract for every
 * route; cookie parsing + CORS are server-wide middleware concerns.
 */
import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import cookieParser from 'cookie-parser'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Document } from './document.entity.js'
import { Session } from './session.entity.js'
import { User } from './user.entity.js'
import { appConfigs, DEFAULT_ALLOWED_ORIGINS } from './app-config.js'
import { AuthModule } from './auth.module.js'
import { GlobalExceptionFilter } from './global-exception.filter.js'
import { EnvelopeInterceptor } from './envelope.interceptor.js'
import { DocumentsModule } from './documents.module.js'
import { AlgorithmModule } from './algorithm.module.js'
import { HomeModule } from './home.module.js'
import { SessionGuard } from './session.guard.js'

@Module({
  imports: [
    ConfigModule.forRoot({ load: appConfigs, isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        type: 'better-sqlite3' as const,
        database: process.env['SQLITE_PATH'] ?? ':memory:',
        entities: [User, Session, Document],
        synchronize: true,
      }),
    }),
    AuthModule,
    DocumentsModule,
    AlgorithmModule,
    HomeModule,
  ],
  providers: [
    // Validation: whitelist strips unknown props, transform coerces types.
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }) },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // GLOBAL auth guard: home + documents opt OUT via @Public(); everything
    // else requires a session by default (secure-by-default routing).
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    void consumer
  }
}

/** Express-level wiring shared by main.ts and the supertest bootstrap. */
export function configureExpress(app: NestExpressApplication, config: ConfigService): void {
  app.use(cookieParser())
  const origins = (process.env['ALLOWED_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')
  const allowed = origins.length > 0 ? origins : DEFAULT_ALLOWED_ORIGINS
  app.enableCors({ origin: allowed, credentials: true })
  app.set('trust proxy', 1)
  void config
}
