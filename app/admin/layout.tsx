import { Metadata } from 'next'
import Script from 'next/script'

export const metadata: Metadata = {
  title: 'Admin Dashboard',
}

export default function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>): JSX.Element {
  return (
    <div className="min-h-screen bg-black">
      <Script src="/spotify-init.js" strategy="beforeInteractive" />
      <main className="container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  )
}
