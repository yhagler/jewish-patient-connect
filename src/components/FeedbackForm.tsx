'use client'

import { useState } from 'react'
import posthog from 'posthog-js'
import Honeypot from './Honeypot'
import TurnstileWidget from './TurnstileWidget'
import { submitRequest } from '@/lib/submitRequest'
import type { ContactHospitalData } from '@/types'

type Props = {
  heading: string
  successMessage: string
  /** 'modal' (default) renders the fixed-backdrop dialog used by FeedbackButton;
   *  'inline' renders just the card content, for embedding as a full page (the
   *  mobile Feedback tab). */
  variant?: 'modal' | 'inline'
  /** Required for 'modal' (backdrop tap / ✕ / success "Close"); unused inline. */
  onClose?: () => void
}

export default function FeedbackForm({ heading, successMessage, variant = 'modal', onClose }: Props) {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    setStatus('submitting')
    setError('')
    try {
      const contact: ContactHospitalData = {
        fullName: '',
        phone: '',
        email: email.trim(),
        preferredContact: 'email',
        hospitalId: '',
        unitFloorRoom: '',
      }
      await submitRequest('Feedback', contact, { message: message.trim() }, honeypot, turnstileToken)
      posthog.capture('feedback_submitted', { variant })
      setStatus('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('error')
    }
  }

  const wrap = (children: React.ReactNode) =>
    variant === 'modal' ? (
      // onClick on the backdrop itself (not bubbled up from the card) closes
      // it, same as the ✕ — checking e.target === e.currentTarget rather than
      // stopPropagation on the card below, so a click anywhere inside the
      // card (including future children that don't know to stop it) can
      // never accidentally fall through and close the whole thing.
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      >
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">{children}</div>
      </div>
    ) : (
      <div className="mx-auto w-full max-w-md px-4 py-8">{children}</div>
    )

  if (status === 'success') {
    return wrap(
      <>
        <h3 className="text-lg font-semibold text-slate-900">Thanks for your note!</h3>
        <p className="mt-2 text-sm text-slate-600">{successMessage}</p>
        {variant === 'modal' && (
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Close
          </button>
        )}
      </>
    )
  }

  return wrap(
    <>
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold text-slate-900">{heading}</h3>
        {variant === 'modal' && (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            &times;
          </button>
        )}
      </div>

        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          For adding, fixing, or removing a specific listing, use the{' '}
          <span className="font-medium text-slate-600">Add</span>,{' '}
          <span className="font-medium text-slate-600">Edit</span>, or{' '}
          <span className="font-medium text-slate-600">Report</span> buttons
          on that listing — those get handled fastest.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <Honeypot value={honeypot} onChange={setHoneypot} />

          <div>
            <label htmlFor="feedback-message" className="block text-sm font-medium text-slate-700">
              Your feedback
            </label>
            <textarea
              id="feedback-message"
              required
              rows={4}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="feedback-email" className="block text-sm font-medium text-slate-700">
              Email <span className="font-normal text-slate-400">(optional, if you&apos;d like a reply)</span>
            </label>
            <input
              id="feedback-email"
              type="email"
              maxLength={200}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <TurnstileWidget onVerify={setTurnstileToken} />

          {status === 'error' && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={status === 'submitting' || !message.trim()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {status === 'submitting' ? 'Sending...' : 'Send feedback'}
          </button>
      </form>
    </>
  )
}
