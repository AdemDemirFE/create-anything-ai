/**
 * DocumentsController — per-user documents CRUD. All queries are scoped by
 * the session user (CurrentUser, set by SessionGuard). Search terms are
 * literal substrings: LIKE wildcards in the USER term are escaped and the
 * ESCAPE character is bound as a parameter (sqlite/PostgreSQL safe).
 */
import { Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { Repository } from 'typeorm'
import { Document } from './document.entity.js'
import { ApiError } from './api-error.js'
import { ERROR_CODES } from './error-codes.js'
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from './validation-bounds.js'
import { SessionGuard } from './session.guard.js'
import { CurrentUser } from './current-user.decorator.js'

export class CreateDocumentDto {
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string

  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content!: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_TITLE_LENGTH, { each: true })
  tags?: string[]
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Title is required.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_TITLE_LENGTH, { each: true })
  tags?: string[]
}

const PAGE_LIMIT = 20

interface DocumentDto {
  id: number
  title: string
  content: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

@Controller('documents')
@UseGuards(SessionGuard)
export class DocumentsController {
  constructor(
    @InjectRepository(Document) private readonly documents: Repository<Document>,
  ) {}
  private toDto(doc: Document): DocumentDto {
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }
  }

  @Get()
  async list(
    @CurrentUser() userId: number,
    @Query('page') rawPage?: string,
    @Query('search') rawSearch?: string,
  ): Promise<unknown> {
    const page = Math.max(1, Math.floor(Number(rawPage ?? '1')) || 1)
    const search = (rawSearch ?? '').slice(0, 200)

    const builder = this.documents
      .createQueryBuilder('document')
      .where('document.userId = :userId', { userId })
      .orderBy('document.updatedAt', 'DESC')
      .skip((page - 1) * PAGE_LIMIT)
      .take(PAGE_LIMIT)

    if (search !== '') {
      // Literal-substring match: escape LIKE wildcards inside the USER term
      // (% _ \) so "50% off" matches "50% off" only; the %...% wrappers stay
      // OUR wildcards. The ESCAPE char is passed as a BINDING — portable
      // across sqlite and PostgreSQL.
      const term = search.toLowerCase().replace(/([\\%_])/g, '\\$1')
      builder.andWhere(
        '(LOWER(document.title) LIKE :pattern ESCAPE :esc OR LOWER(document.content) LIKE :pattern ESCAPE :esc)',
        { pattern: `%${term}%`, esc: '\\' },
      )
    }

    const [rows, total] = await builder.getManyAndCount()
    return {
      documents: rows.map((row) => this.toDto(row)),
      pagination: { page, limit: PAGE_LIMIT, total, pages: Math.ceil(total / PAGE_LIMIT) },
    }
  }

  @Get(':id')
  async get(@CurrentUser() userId: number, @Param('id', ParseIntPipe) id: number): Promise<unknown> {
    const doc = await this.documents.findOne({ where: { id, userId } })
    if (!doc) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Document not found.', 404)
    return this.toDto(doc)
  }

  @Post()
  async create(@CurrentUser() userId: number, @Body() dto: CreateDocumentDto): Promise<unknown> {
    const doc = await this.documents.save(
      this.documents.create({
        userId,
        title: dto.title,
        content: dto.content,
        tagsJson: JSON.stringify(dto.tags ?? []),
      }),
    )
    return this.toDto(doc)
  }

  @Patch(':id')
  async update(
    @CurrentUser() userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDocumentDto,
  ): Promise<unknown> {
    const doc = await this.documents.findOne({ where: { id, userId } })
    if (!doc) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Document not found.', 404)
    if (dto.title !== undefined) doc.title = dto.title
    if (dto.content !== undefined) doc.content = dto.content
    if (dto.tags !== undefined) doc.tagsJson = JSON.stringify(dto.tags)
    const saved = await this.documents.save(doc)
    return this.toDto(saved)
  }

  @Delete(':id')
  async delete(@CurrentUser() userId: number, @Param('id', ParseIntPipe) id: number): Promise<unknown> {
    const result = await this.documents.delete({ id, userId })
    if (!result.affected) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Document not found.', 404)
    return null
  }
}
