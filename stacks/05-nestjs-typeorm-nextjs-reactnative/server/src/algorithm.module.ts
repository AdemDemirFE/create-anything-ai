/**
 * AlgorithmModule — fixed-catalog workbench (screen 4).
 */
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AlgorithmController } from './algorithm.controller.js'
import { AlgorithmEngine } from './algorithm.engine.js'

@Module({
  imports: [ConfigModule],
  controllers: [AlgorithmController],
  providers: [AlgorithmEngine],
})
export class AlgorithmModule {}
