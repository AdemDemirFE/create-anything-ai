import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

/**
 * Documents (notes) — per-user rows. All queries are scoped by userId;
 * search is a literal-substring match (LIKE wildcards escaped).
 */
@Entity('documents')
@Index('IX_documents_user_updated', ['userId', 'updatedAt'])
export class Document {
  @PrimaryGeneratedColumn('increment')
  id!: number

  @Column('integer', { name: 'user_id' })
  userId!: number

  @Column('text')
  title!: string

  @Column('text')
  content!: string

  /** JSON-encoded string[] (sqlite-friendly); validated on write. */
  @Column('text', { name: 'tags_json', default: '[]' })
  tagsJson!: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date

  get tags(): string[] {
    try {
      const parsed: unknown = JSON.parse(this.tagsJson)
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
    } catch {
      return []
    }
  }
}
