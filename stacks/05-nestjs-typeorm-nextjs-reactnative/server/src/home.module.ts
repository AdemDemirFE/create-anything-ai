/**
 * HomeModule — /api/v1/home (screen 3): authenticated profile + metrics.
 */
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Document } from './document.entity.js'
import { HomeController } from './home.controller.js'
import { AuthModule } from './auth.module.js'

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Document]), AuthModule],
  controllers: [HomeController],
})
export class HomeModule {}
