/**
 * Shared server-side type augmentation.
 * (res.locals.user is set by requireUser(); sessions return this shape.)
 */
export interface SessionUser {
  uid: string
  email: string
  displayName: string | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      user?: SessionUser
    }
  }
}

export {}
