/**
 * Auth DTOs — class-validator rules are the SINGLE validation truth on the
 * wire. Field-level errors surface as envelope `details` via the global
 * filter (ValidationPipe shape mapping). Email is NORMALIZED (trim +
 * lowercase) at the transform stage — BEFORE validation and before the
 * uniqueness check — so `  User@Example.COM  ` is one and the same
 * identity as `user@example.com`.
 */
import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from './validation-bounds.js'

const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))

export class RegisterDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @IsNotEmpty({ message: 'Email is required.' })
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters.' })
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string
}

export class LoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @IsNotEmpty({ message: 'Email is required.' })
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string

  @IsString()
  @MinLength(1, { message: 'Password is required.' })
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string
}
