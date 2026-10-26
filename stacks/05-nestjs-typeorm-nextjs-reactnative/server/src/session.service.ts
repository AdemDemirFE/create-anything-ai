/**
 * SessionService — opaque session tokens with SHA-256 digests at rest.
 *
 * The browser only ever sees a random 32-byte token in an HttpOnly,
 * SameSite=Lax cookie; the database stores only the digest, so a read of
 * the sessions table cannot be replayed as a session (stack-18/19 pattern).
 * Idle expiry via expiresAt; logout deletes the row (revocation).
 */
import { createHash, randomBytes } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { LessThan, Repository } from 'typeorm'
import { Session } from './session.entity.js'

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

@Injectable()
export class SessionService {
  private readonly ttlMs: number
  private readonly cookieName: string
  private readonly secureCookies: boolean

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {
    this.ttlMs = Math.max(1, config.get<number>('session.ttlMinutes', 30)) * 60_000
    this.cookieName = config.get<string>('session.cookieName', 'stack05_session')
    this.secureCookies = config.get<boolean>('session.secureCookies', false)
  }

  get cookieOptions(): {
    httpOnly: true
    sameSite: 'lax'
    secure: boolean
    path: string
    maxAge: number
  } {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookies,
      path: '/',
      maxAge: this.ttlMs,
    }
  }

  get name(): string {
    return this.cookieName
  }

  /** Issues a session for the user; returns the RAW token (cookie value). */
  async issue(userId: number): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + this.ttlMs)
    await this.sessions.insert({
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      createdAt: new Date(),
    })
    return { token, expiresAt }
  }

  /** Resolves a raw cookie token to the owning user id, or null. */
  async resolve(token: string | undefined | null): Promise<number | null> {
    if (!token || token.length > 512) return null
    const tokenHash = hashToken(token)
    const row = await this.sessions.findOne({ where: { tokenHash } })
    if (!row) return null
    if (row.expiresAt.getTime() <= Date.now()) {
      await this.sessions.delete({ tokenHash })
      return null
    }
    return row.userId
  }

  /** Revokes one session (logout). */
  async revoke(token: string | undefined | null): Promise<void> {
    if (!token) return
    await this.sessions.delete({ tokenHash: hashToken(token) })
  }

  /** Housekeeping: purge expired rows. */
  async purgeExpired(): Promise<void> {
    await this.sessions.delete({ expiresAt: LessThan(new Date()) })
  }
}
