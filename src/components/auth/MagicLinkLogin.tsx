'use client'

import { useState } from 'react'
import posthog from 'posthog-js'

// Shared magic-link sign-in form — used by /admin and /inbox, which check
// different email allowlists (ADMIN_EMAILS vs INBOX_EMAILS) but share the same
// Supabase Auth user pool and the same "send a link, no password" UX. The
// allowlist check happens server-side in each route's own request-link
// endpoint; this component has no idea which list it's talking to.
type Props = {
  /** Which request-link endpoint to POST to, e.g. '/api/admin/request-link'. */
  requestLinkUrl: string
  /** Label above the email input, e.g. "Admin email" or "Inbox email". */
  emailLabel: string
  /** Shown after a link is sent — phrase the allowlist in plain language,
   *  e.g. "an authorized admin" or "allowed to view the inbox". */
  sentMessage: string
}

export default function MagicLinkLogin({ requestLinkUrl, emailLabel, sentMessage }: Props) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSending(true)
    try {
      const res = await fetch(requestLinkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.error || 'Could not send the sign-in link.')
      posthog.capture('magic_link_requested', {
        destination: requestLinkUrl.includes('/admin/') ? 'admin' : 'inbox',
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the sign-in link.')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-5">
        <p className="text-sm text-green-800">
          If that email is {sentMessage}, a sign-in link is on its way. Open it on this device to
          continue.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm space-y-3">
      <label className="block text-sm font-medium text-slate-700">{emailLabel}</label>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={sending}
        className="bg-primary text-white font-medium px-4 py-2 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-60 cursor-pointer"
      >
        {sending ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  )
}
