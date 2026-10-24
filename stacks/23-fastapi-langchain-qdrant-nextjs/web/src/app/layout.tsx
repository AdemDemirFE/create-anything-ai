import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stack 23 · FastAPI + LangChain + Qdrant + Next.js',
  description: 'RAG reference implementation: upload documents, ask grounded questions.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
