'use client'

import { useState } from 'react'
import posthog from 'posthog-js'
import type { DirectoryResource } from '@/types'
import UpButton from '@/components/UpButton'
import Honeypot from '@/components/Honeypot'
import TurnstileWidget from '@/components/TurnstileWidget'

type Props = {
  listing: DirectoryResource
  /** The category this listing belongs to — the Up destination, e.g. "Synagogues". */
  upLabel: string
  onUp: () => void
  onSubmitted: () => void
  /** Admin-preview only: Submit shows the confirmation screen without actually
   *  posting a report. Used by the category editor's Preview. */
  preview?: boolean
}

export default function ReportListing({ listing, upLabel, onUp, onSubmitted, preview }: Props) {
  const [note, setNote] = useState('')
  const [submitterName, setSubmitterName] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (preview) {
      setDone(true)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'delete',
          targetType: 'listing',
          targetId: listing.id,
          note: note.trim() || undefined,
          submittedBy: submitterName.trim() ? { name: submitterName.trim() } : undefined,
          company: honeypot,
          turnstileToken,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        setError((body.errors ?? ['Something went wrong.']).join(' '))
        return
      }
      posthog.capture('listing_problem_reported', {
        listing_id: listing.id,
        category_id: listing.category,
      })
      setDone(true)
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary'

  if (done) {
    return (
      <div>
        <UpButton label={upLabel} onClick={onSubmitted} />
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <p className="text-2xl mb-2">🙏</p>
          <h2 className="text-lg font-semibold text-green-800 mb-1">Thanks for the heads-up</h2>
          <p className="text-sm text-green-700">We&apos;ll review this and update the listing if needed.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <UpButton label={upLabel} onClick={onUp} />

      <h2 className="text-xl font-semibold text-slate-800 mb-1">Report a problem</h2>
      <p className="text-sm text-muted mb-2">
        Use this to report that <span className="font-medium text-slate-700">{listing.name}</span> has{' '}
        <span className="font-medium text-slate-700">permanently closed</span>. A moderator reviews every
        report before anything changes.
      </p>
      <p className="text-sm text-muted mb-5">
        If it moved or has wrong info, please use <span className="font-medium text-slate-700">Edit</span>{' '}
        instead so the listing can be corrected.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Honeypot value={honeypot} onChange={setHoneypot} />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">What&apos;s the issue?</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. This location closed permanently."
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Your name (optional)</label>
          <input value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} className={inputClass} />
        </div>

        {error && <p className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">{error}</p>}

        <TurnstileWidget onVerify={setTurnstileToken} />

        <button
          type="submit"
          disabled={submitting}
          className="w-full sm:w-auto bg-primary text-white font-medium px-5 py-2.5 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting ? 'Submitting…' : 'Submit report'}
        </button>
      </form>
      </div>
    </div>
  )
}
