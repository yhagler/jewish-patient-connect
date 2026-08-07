'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getBrowserClient } from '@/lib/supabase/client'
import posthog from 'posthog-js'
import MagicLinkLogin from '@/components/auth/MagicLinkLogin'
import ResponseCard from '@/components/responses/ResponseCard'
import {
  INBOX_TABS,
  INBOX_TAB_LABELS,
  inboxTabForRequestType,
  type InboxTab,
  type InboxResponse,
} from '@/lib/inbox'

// The inbox: a separate, separately-gated viewer for form response data
// (support requests, volunteer signups/edits/removals, feedback), read from
// the `form_response` table. Deliberately its own route with its own
// magic-link login (INBOX_EMAILS, checked in inboxAuth.ts) — NOT a tab bolted
// onto /admin — so someone with only inbox access never even sees the
// Categories/Site tabs, and someone with only admin access sees none of this.

export default function InboxPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const supabase = getBrowserClient()

    function identifyInboxUser(activeSession: Session) {
      posthog.identify(activeSession.user.id, {
        email: activeSession.user.email,
        role: 'inbox_user',
      })
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) identifyInboxUser(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' && s) identifyInboxUser(s)
      if (event === 'SIGNED_OUT') posthog.reset()
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!ready) {
    return <Shell><p className="text-sm text-muted">Loading…</p></Shell>
  }

  if (!session) {
    return (
      <Shell>
        <MagicLinkLogin
          requestLinkUrl="/api/inbox/request-link"
          emailLabel="Inbox email"
          sentMessage="allowed to view the inbox"
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <InboxTabs session={session} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Inbox</h1>
      <p className="text-sm text-muted mb-6">
        Support requests, volunteer signups, and feedback submitted through the site.
      </p>
      {children}
    </main>
  )
}

// Mirrors AdminNavState in admin/page.tsx — one history entry per tab switch,
// so browser Back walks tabs instead of leaving /inbox.
type InboxNavState = { inboxTab?: InboxTab }

function InboxTabs({ session }: { session: Session }) {
  const [tab, setTab] = useState<InboxTab>('support')
  const [items, setItems] = useState<InboxResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const token = session.access_token

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const s = e.state as InboxNavState | null
      setTab(s?.inboxTab ?? 'support')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // On a full reload the browser keeps the current entry's history.state —
  // restore whichever tab the viewer was on instead of resetting to Support.
  useEffect(() => {
    const s = window.history.state as InboxNavState | null
    if (s?.inboxTab) setTab(s.inboxTab)
  }, [])

  function goToTab(t: InboxTab) {
    setTab(t)
    history.pushState({ inboxTab: t } as InboxNavState, '')
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/inbox', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        setError(`Signed in as ${session.user.email}, but this account isn't allowed to view the inbox.`)
        setItems([])
        return
      }
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.errors?.join(' ') || 'Failed to load.')
      setItems(body.responses as InboxResponse[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }, [token, session.user.email])

  useEffect(() => {
    load()
  }, [load])

  async function signOut() {
    await getBrowserClient().auth.signOut()
  }

  function handleUpdated(updated: InboxResponse) {
    setItems((prev) => prev?.map((it) => (it.id === updated.id ? updated : it)) ?? prev)
  }

  function handleDeleted(id: string) {
    setItems((prev) => prev?.filter((it) => it.id !== id) ?? prev)
    setExpandedId((cur) => (cur === id ? null : cur))
  }

  // Group once per render — cheap at this volume, and keeps inboxTabForRequestType
  // (the RequestType → InboxTab mapping) as the single source of truth rather
  // than duplicating it into a query param.
  const grouped: Record<InboxTab, InboxResponse[]> = {
    support: [],
    volunteers: [],
    volunteerChanges: [],
  }
  if (items) {
    for (const item of items) grouped[inboxTabForRequestType(item.requestType)].push(item)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">
          Signed in as <span className="font-medium text-slate-700">{session.user.email}</span>
        </p>
        <button onClick={signOut} className="text-sm text-muted hover:text-slate-700 underline cursor-pointer">
          Sign out
        </button>
      </div>

      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {INBOX_TABS.map((t) => (
          <button
            key={t}
            onClick={() => goToTab(t)}
            className={`text-sm font-medium px-3 py-2 -mb-px border-b-2 transition-colors cursor-pointer ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-slate-700'
            }`}
          >
            {INBOX_TAB_LABELS[t]}
            {items && <span className="ml-1.5 text-xs text-muted tabular-nums">{grouped[t].length}</span>}
          </button>
        ))}
      </div>

      {error && (
        <p className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 mb-4">{error}</p>
      )}

      {items === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : grouped[tab].length === 0 ? (
        <p className="text-sm text-muted">Nothing here yet.</p>
      ) : (
        <div className="space-y-3">
          {grouped[tab].map((item) => (
            <ResponseCard
              key={item.id}
              item={item}
              token={token}
              apiBase="/api/inbox"
              expanded={expandedId === item.id}
              onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}
