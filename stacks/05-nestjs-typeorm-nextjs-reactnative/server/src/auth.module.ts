/**
 * AuthModule — users + sessions repositories, password hashing, the
 * session-backed auth flow, and the login throttle wired INTO the login
 * endpoint (429 + Retry-After when the configured failure window trips).
 */
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Session } from './session.entity.js'
import { User } from './user.entity.js'
import { AuthService } from './auth.service.js'
import { AuthController } from './auth.controller.js'
import { PasswordService } from './password.service.js'
import { SessionService } from './session.service.js'
import { LoginThrottleService } from './login-throttle.service.js'
import { LoginThrottleInterceptor } from './login-throttle.interceptor.js'
import { SessionGuard } from './session.guard.js'

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([User, Session])],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    LoginThrottleService,
    // Global interceptor: self-gates to POST /auth/login only.
    { provide: APP_INTERCEPTOR, useClass: LoginThrottleInterceptor },
    SessionGuard,
  ],
  exports: [SessionService, SessionGuard, AuthService],
})
export class AuthModule {}
