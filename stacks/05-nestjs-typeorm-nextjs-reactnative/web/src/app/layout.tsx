import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stack 05 — NestJS + TypeORM + Next.js',
  description: 'Four-screen reference: register, login, home, algorithm workbench.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Stack 05</Link>
          <nav className="nav">
            <Link href="/register">Register</Link>
            <Link href="/login">Login</Link>
            <Link href="/home">Home</Link>
            <Link href="/algorithm">Algorithm</Link>
          </nav>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  )
}
