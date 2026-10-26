import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="card">
      <h1>Stack 05 — NestJS 11 + TypeORM + Next.js 15</h1>
      <p>
        Four-screen contract reference: <Link href="/register">Register</Link>,{' '}
        <Link href="/login">Login</Link>, <Link href="/home">Home</Link> and the{' '}
        <Link href="/algorithm">algorithm workbench</Link>. The web client talks
        to the NestJS API through a same-origin <code>/api/v1</code> proxy; the
        session is an HttpOnly cookie with an opaque server-side token.
      </p>
    </div>
  )
}
