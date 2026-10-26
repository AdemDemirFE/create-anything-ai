/**
 * AuthController — /api/v1/auth endpoints. Sets/clears the HttpOnly
 * session cookie; never logs credentials (no logger calls with secrets).
 */
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { AuthService } from './auth.service.js'
import { LoginDto, RegisterDto } from './auth.dto.js'
import { Public } from './public.decorator.js'

interface AuthedRequest extends Request {
  userId?: number
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private cookieName(): string {
    return this.config.get<string>('session.cookieName', 'stack05_session')
  }

  private cookieOptions(): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: string; maxAge: number } {
    const ttlMinutes = this.config.get<number>('session.ttlMinutes', 30)
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<boolean>('session.secureCookies', false),
      path: '/',
      maxAge: Math.max(1, ttlMinutes) * 60_000,
    }
  }

  @Post('register')
  @Public()
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const cookieName = this.cookieName()
    const existing = request.cookies?.[cookieName]
    const result = await this.auth.register(dto, existing)
    response.cookie(cookieName, result.sessionToken, this.cookieOptions())
    return { user: result.user }
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const result = await this.auth.login(dto)
    response.cookie(this.cookieName(), result.sessionToken, this.cookieOptions())
    return { user: result.user }
  }

  @Post('logout')
  @Public()
  @HttpCode(200)
  async logout(@Req() request: AuthedRequest, @Res({ passthrough: true }) response: Response): Promise<unknown> {
    const cookieName = this.cookieName()
    await this.auth.logout(request.cookies?.[cookieName])
    response.clearCookie(cookieName, { path: '/' })
    return null
  }

  @Get('me')
  @Public()
  async me(@Req() request: AuthedRequest): Promise<unknown> {
    if (!request.userId) return { user: null }
    const user = await this.auth.publicUser(request.userId)
    return { user }
  }
}
