/**
 * DocumentsModule — per-user documents CRUD over the documents table.
 */
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Document } from './document.entity.js'
import { DocumentsController } from './documents.controller.js'
import { AuthModule } from './auth.module.js'

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Document]), AuthModule],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
