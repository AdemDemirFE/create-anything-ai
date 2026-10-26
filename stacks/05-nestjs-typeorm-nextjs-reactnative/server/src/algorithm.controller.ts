/**
 * AlgorithmController — /api/v1/algorithm endpoints (screen 4).
 * GET / returns the catalog + the ENGINE's effective bound;
 * POST /run validates + executes. The engine is the single source of truth
 * for the bound: it re-checks id + length even though the DTO pre-validates.
 */
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common'
import { IsString, MaxLength, MinLength } from 'class-validator'
import { AlgorithmEngine } from './algorithm.engine.js'
import { MAX_ALGORITHM_INPUT_LENGTH } from './validation-bounds.js'
import { Public } from './public.decorator.js'

export class RunAlgorithmDto {
  // NOTE: the id and the length bound are re-checked by the ENGINE (single
  // source of truth) — the DTO only guards the outer transport limit, so
  // engine errors (UNKNOWN_ALGORITHM / INPUT_TOO_LARGE) keep their codes.
  @IsString()
  algorithmId!: string

  @IsString()
  @MinLength(1, { message: 'Input is required.' })
  @MaxLength(MAX_ALGORITHM_INPUT_LENGTH + 1)
  input!: string
}

@Controller('algorithm')
@Public()
export class AlgorithmController {
  constructor(@Inject(AlgorithmEngine) private readonly engine: AlgorithmEngine) {}

  @Get()
  catalog(): unknown {
    return {
      algorithms: this.engine.catalog(),
      maxInputLength: this.engine.maxInput,
    }
  }

  @Post('run')
  @HttpCode(200)
  run(@Body() dto: RunAlgorithmDto): unknown {
    return this.engine.run(dto.algorithmId, dto.input)
  }
}
