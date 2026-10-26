/**
 * AuthService — register/login/logout against the users + sessions tables.
 *
 * Anti-enumeration: registration failure and login failure return the same
 * shape of generic errors (EMAIL_TAKEN is only returned to the REGISTERING
 * party, never to a login attempt — login failures are always
 * INVALID_CREDENTIALS). Email is normalized (lowercase + trim) BEFORE the
 * unique check; the unique index lives in the database, so concurrent
 * registers race to the persistence layer, not to app-level checks.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { QueryFailedError, Repository } from 'typeorm'
import { ApiError } from './api-error.js'
import { ERROR_CODES } from './error-codes.js'
import { LoginDto, RegisterDto } from './auth.dto.js'
import { PasswordService } from './password.service.js'
import { SessionService } from './session.service.js'
import { User } from './user.entity.js'

export interface PublicUser {
  id: number
  email: string
}

export interface AuthResult {
  user: PublicUser
  sessionToken: string
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private toPublic(user: User): PublicUser {
    return { id: user.id, email: user.email }
  }

  async register(dto: RegisterDto, sessionCookie: string | undefined): Promise<AuthResult> {
    const emailNormalized = normalizeEmail(dto.email)

    const existing = await this.users.findOne({ where: { emailNormalized } })
    if (existing) {
      // Same message class for all register rejections (anti-enumeration).
      throw new ApiError(ERROR_CODES.EMAIL_TAKEN, 'That email cannot be used.', 409)
    }

    // Password complexity: enforce server-side AFTER normalization.
    if (dto.password.length < 10 || !/[a-z]/.test(dto.password) || !/[A-Z]/.test(dto.password) || !/[0-9]/.test(dto.password)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'The request contains invalid fields.', 400, [
        { field: 'password', code: 'WEAK_PASSWORD', message: 'Password needs upper case, lower case and a digit.' },
      ])
    }

    const passwordHash = await this.passwords.hash(dto.password)

    // Persist: the UNIQUE index decides. A concurrent register with the
    // same normalized email surfaces as a QueryFailedError on sqlite
    // (SQLITE_CONSTRAINT_UNIQUE) — mapped to the same 409.
    let user: User
    try {
      user = await this.users.save(this.users.create({ email: dto.email.trim(), emailNormalized, passwordHash }))
    } catch (err) {
      if (err instanceof QueryFailedError) {
        throw new ApiError(ERROR_CODES.EMAIL_TAKEN, 'That email cannot be used.', 409)
      }
      throw err
    }

    // Single-session-per-browser convenience: revoking an existing session
    // (if the caller already carried a cookie) prevents silent accumulation.
    if (sessionCookie) await this.sessions.revoke(sessionCookie)

    const { token } = await this.sessions.issue(user.id)
    return { user: this.toPublic(user), sessionToken: token }
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const emailNormalized = normalizeEmail(dto.email)
    const user = await this.users.findOne({ where: { emailNormalized } })
    // Same error + same work factor whether or not the user exists: when
    // missing, run one dummy verify to equalize timing.
    if (!user) {
      await this.passwords.verify(dto.password, DUMMY_HASH)
      throw new ApiError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.', 401)
    }
    const ok = await this.passwords.verify(dto.password, user.passwordHash)
    if (!ok) {
      throw new ApiError(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.', 401)
    }
    const { token } = await this.sessions.issue(user.id)
    return { user: this.toPublic(user), sessionToken: token }
  }

  async userIdFromCookie(token: string | undefined | null): Promise<number | null> {
    return this.sessions.resolve(token)
  }

  async logout(token: string | undefined | null): Promise<void> {
    await this.sessions.revoke(token)
  }

  async userEmail(userId: number): Promise<string | null> {
    const user = await this.users.findOne({ where: { id: userId } })
    return user?.email ?? null
  }

  /** Home metrics source. */
  async publicUser(userId: number): Promise<PublicUser | null> {
    const user = await this.users.findOne({ where: { id: userId } })
    return user ? this.toPublic(user) : null
  }

  get sessionCookieName(): string {
    return this.config.get<string>('session.cookieName', 'stack05_session')
  }
}

/**
 * A valid-format scrypt digest of an unguessable random string — used to
 * equalize login timing for unknown accounts (never a real credential).
 */
const DUMMY_HASH = 'scrypt$32768$8$1$0123456789abcdef0123456789abcdef$' + '0'.repeat(128)
