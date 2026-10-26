import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'

/**
 * Users table. Email is normalized (lowercase + trim) BEFORE the unique
 * check runs — uniqueness is enforced at the PERSISTENCE layer via a
 * UNIQUE index over the normalized column, so a race between two
 * concurrent registers still cannot create duplicates.
 */
@Entity('users')
@Index('UQ_users_email_normalized', ['emailNormalized'], { unique: true })
export class User {
  @PrimaryGeneratedColumn('increment')
  id!: number

  /** Display form as registered (trimmed). */
  @Column('text', { name: 'email' })
  email!: string

  /** Normalized (lowercase + trim) form carrying the unique index. */
  @Column('text', { name: 'email_normalized', unique: true })
  emailNormalized!: string

  /** scrypt hex digest (N=2^15, r=8, p=1) + per-password random salt. */
  @Column('text', { name: 'password_hash' })
  passwordHash!: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date
}
