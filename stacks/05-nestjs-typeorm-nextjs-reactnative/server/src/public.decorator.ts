import { SetMetadata } from '@nestjs/common'

/** Marks a route as public (skips the global SessionGuard). */
export const IS_PUBLIC_KEY = 'isPublic'
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true)
