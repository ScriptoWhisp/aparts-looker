/**
 * Shell — top-level layout container.
 *
 * Renders the sticky Header + the active route content below it.
 * Hash routing is handled by App.tsx via useHashRoute(); Shell just
 * provides the chrome frame.
 *
 * Responsive plumbing: the html element has `dark` class (Nocturne dark-first).
 * Body has bg-app text-text font-sans via index.css.
 * Shell adds no desktop-only assumptions — Wave 7B mobile Inbox works within this.
 */

import { Header } from './Header'
import { MobileBottomNav } from './MobileBottomNav'
import { FeedbackButton } from '../feedback/FeedbackButton'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import type { ReactNode } from 'react'

interface ShellProps {
  children: ReactNode
}

export function Shell({ children }: ShellProps) {
  const isMobile = useMediaQuery('(max-width: 767px)')

  return (
    <div className="flex flex-col min-h-screen bg-app">
      <Header />
      <main className={['flex-1 min-h-0', isMobile ? 'pb-14' : ''].join(' ')}>
        {children}
      </main>
      {isMobile && <MobileBottomNav />}
      <FeedbackButton />
    </div>
  )
}
