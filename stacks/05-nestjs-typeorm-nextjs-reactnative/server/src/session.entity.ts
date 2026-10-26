import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * Sessions — one row per issued browser session. Only the SHA-256 digest
 * of the opaque token is stored; the raw token lives solely in the
 * HttpOnly cookie. A user may hold several sessions (multiple browsers).
 */
@Entity('sessions')
@Index('UQ_sessions_token_hash', ['tokenHash'], { unique: true })
@Index('IX_sessions_user', ['userId'])
@Index('IX_sessions_expires', ['expiresAt'])
export class Session {
  @PrimaryGeneratedColumn('increment')
  id!: number

  @Column('integer', { name: 'user_id' })
  userId!: number

  @Column('text', { name: 'token_hash' })
  tokenHash!: string

  @Column('datetime', { name: 'expires_at' })
  expiresAt!: Date

  @Column('datetime', { name: 'created_at' })
  createdAt!: Date
}
