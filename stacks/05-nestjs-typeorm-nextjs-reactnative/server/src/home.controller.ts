/**
 * HomeController — /api/v1/home (screen 3): authenticated profile + safe
 * sample metrics. Backend authentication is REQUIRED (SessionGuard) — the
 * client gating is convenience, never the trust boundary.
 */
import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Document } from './document.entity.js'
import { AuthService } from './auth.service.js'
import { SessionGuard } from './session.guard.js'
import { CurrentUser } from './current-user.decorator.js'

@Controller('home')
@UseGuards(SessionGuard)
export class HomeController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
  ) {}

  @Get()
  async home(@CurrentUser() userId: number): Promise<unknown> {
    const user = await this.auth.publicUser(userId)
    const total = await this.documents.count({ where: { userId } })
    return {
      email: user?.email ?? 'unknown@example.com',
      metrics: [
        { label: 'Documents stored', value: String(total), unit: 'documents' },
        { label: 'Session model', value: 'HttpOnly cookie + opaque token', unit: '' },
        { label: 'Server uptime', value: `${Math.floor(process.uptime())}`, unit: 's' },
      ],
      serverTime: new Date().toISOString(),
    }
  }
}
