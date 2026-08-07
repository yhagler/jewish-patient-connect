'use client'

import { useEffect, useState } from 'react'
import posthog from 'posthog-js'

const TOKEN_KEY = 'jpc_voter_token'
const VOTED_KEY = 'jpc_voted'

// A stable anonymous token per browser (created on first vote). Lets the server
// dedupe one vote per browser without requiring accounts.
function getToken(): string {
  let t = localStorage.getItem(TOKEN_KEY)
  if (!t) {
    t = crypto.randomUUID()
    localStorage.setItem(TOKEN_KEY, t)
  }
  return t
}

function getVotedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VOTED_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

function rememberVote(id: string, voted: boolean) {
  const s = getVotedSet()
  if (voted) s.add(id)
  else s.delete(id)
  localStorage.setItem(VOTED_KEY, JSON.stringify([...s]))
}

export default function UpvoteButton({
  resourceId,
  count: initialCount,
  onCountChange,
  variant = 'box',
}: {
  resourceId: string
  count: number
  /** Notifies the parent of the latest count so it can re-sort by popularity. */
  onCountChange?: (count: number) => void
  /** 'box' — the bordered ▲/count tile. 'inline' — a minimal "▲ count" that sits
   *  in a row (used in the collapsed listing header). */
  variant?: 'box' | 'inline'
}) {
  const [count, setCount] = useState(initialCount)
  const [voted, setVoted] = useState(false) // set from localStorage after mount (hydration-safe)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setVoted(getVotedSet().has(resourceId))
  }, [resourceId])

  function applyCount(next: number) {
    setCount(next)
    onCountChange?.(next)
  }

  async function toggle() {
    if (busy) return
    setBusy(true)

    const prevVoted = voted
    const prevCount = count
    // Optimistic update.
    setVoted(!prevVoted)
    applyCount(prevCount + (prevVoted ? -1 : 1))

    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId, token: getToken() }),
      })
      const body = await res.json()
      if (res.ok && body.ok) {
        applyCount(body.count)
        setVoted(body.voted)
        rememberVote(resourceId, body.voted)
        posthog.capture('listing_vote_toggled', {
          listing_id: resourceId,
          voted: body.voted,
        })
      } else {
        setVoted(prevVoted)
        applyCount(prevCount)
      }
    } catch {
      setVoted(prevVoted)
      applyCount(prevCount)
    } finally {
      setBusy(false)
    }
  }

  // Stop propagation so upvoting inside a tappable card header doesn't also
  // toggle the card open/closed.
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggle()
  }

  const title = voted ? 'Remove your upvote' : 'Upvote this place'

  if (variant === 'inline') {
    return (
      <button
        onClick={handleClick}
        disabled={busy}
        aria-pressed={voted}
        title={title}
        className={[
          // Negative margin + padding grows the tap area to ~32px for touch
          // without shifting the surrounding header layout. Mobile only — desktop
          // keeps the original compact hit area (sm:m-0 sm:p-0).
          'inline-flex items-center gap-1 -m-2 p-2 sm:m-0 sm:p-0 text-xs font-medium whitespace-nowrap cursor-pointer transition-colors disabled:opacity-60',
          voted ? 'text-primary' : 'text-slate-600 hover:text-primary',
        ].join(' ')}
      >
        <span aria-hidden="true">▲</span>
        {count}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      aria-pressed={voted}
      title={title}
      className={[
        'flex flex-col items-center justify-center rounded-md border px-2.5 py-1 cursor-pointer transition-colors min-w-[2.75rem]',
        voted
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-slate-300 text-slate-500 hover:border-primary hover:text-primary',
      ].join(' ')}
    >
      <span className="text-sm leading-none" aria-hidden="true">▲</span>
      <span className="text-xs font-semibold leading-tight">{count}</span>
    </button>
  )
}
