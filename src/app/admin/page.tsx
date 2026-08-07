'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getBrowserClient } from '@/lib/supabase/client'
import posthog from 'posthog-js'
import type {
  EnrichedSubmission,
  ResourceRow,
  ResourceSubmission,
  CategorySubmissionPayload,
} from '@/types'
import { isStructuredHours, formatHoursSummary } from '@/lib/hours'
import { isMinyanim, TEFILLAH_LABELS } from '@/lib/davening'
import CategoryManager from '@/components/admin/CategoryManager'
import SiteSettingsEditor from '@/components/admin/SiteSettingsEditor'
import ResponsesManager from '@/components/admin/ResponsesManager'
import ArchivedListings from '@/components/admin/ArchivedListings'
import MagicLinkLogin from '@/components/auth/MagicLinkLogin'

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [devLoginError, setDevLoginError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getBrowserClient()

    function identifyAdmin(activeSession: Session) {
      posthog.identify(activeSession.user.id, {
        email: activeSession.user.email,
        role: 'admin',
      })
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) identifyAdmin(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' && s) identifyAdmin(s)
      if (event === 'SIGNED_OUT') posthog.reset()
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Local-dev-only shortcut: /admin?devToken=<DEV_ADMIN_BYPASS_SECRET> signs in
  // instantly via /api/admin/dev-login instead of the magic-link email — see
  // that route for why this can't do anything on a real deployment. Strips the
  // secret from the URL bar/history immediately either way.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const devToken = params.get('devToken')
    if (!devToken) return

    history.replaceState(history.state, '', window.location.pathname)

    fetch('/api/admin/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: devToken }),
    })
      .then((res) => res.json())
      .then(async (body) => {
        if (!body.ok) throw new Error(body.error || 'Dev login failed.')
        const { error } = await getBrowserClient().auth.setSession({
          access_token: body.accessToken,
          refresh_token: body.refreshToken,
        })
        if (error) throw error
      })
      .catch((err) => setDevLoginError(err instanceof Error ? err.message : 'Dev login failed.'))
  }, [])

  if (!ready) {
    return <Shell><p className="text-sm text-muted">Loading…</p></Shell>
  }

  if (!session) {
    return (
      <Shell>
        {devLoginError && (
          <p className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 mb-4">
            Dev login failed: {devLoginError}
          </p>
        )}
        <MagicLinkLogin
          requestLinkUrl="/api/admin/request-link"
          emailLabel="Admin email"
          sentMessage="an authorized admin"
        />
      </Shell>
    )
  }

  return (
    <Shell>
      <AdminTabs session={session} />
    </Shell>
  )
}

type AdminTab = 'queue' | 'categories' | 'responses' | 'archived' | 'site' | 'home'

// Listed in the order they're rendered below.
const TAB_LABELS: Record<AdminTab, string> = {
  queue: 'Moderation queue',
  responses: 'Responses',
  archived: 'Archived',
  site: 'Site',
  // Not "Home page" any more — what's left here is whatever exists on exactly
  // one of the two devices, and the mobile tab bar shows on every phone screen,
  // not just the home one.
  home: 'Desktop & mobile',
  categories: 'Categories',
}

// The history.state shape this screen stamps on every pushState call, mirroring
// the public page's NavState pattern so browser Back walks admin screens one at
// a time (tab → list → editor) instead of leaving /admin.
type AdminNavState = {
  adminTab?: AdminTab
  /** Which list entry is being edited, only meaningful when adminTab is
   *  'categories' — encoded by CategoryManager as 'cat:<id>', 'cat:new', or
   *  'form:<id>' to cover both listing categories and forms in one list. */
  adminEditing?: string
}

function AdminTabs({ session }: { session: Session }) {
  const [tab, setTab] = useState<AdminTab>('queue')
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const s = e.state as AdminNavState | null
      setTab(s?.adminTab ?? 'queue')
      setEditingId(s?.adminEditing ?? null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // On a full reload the browser keeps the current entry's history.state —
  // restore whichever tab/editor the admin was on instead of resetting to queue.
  useEffect(() => {
    const s = window.history.state as AdminNavState | null
    if (s?.adminTab) setTab(s.adminTab)
    if (s?.adminEditing) setEditingId(s.adminEditing)
  }, [])

  function goToTab(t: AdminTab) {
    setTab(t)
    setEditingId(null)
    history.pushState({ adminTab: t } as AdminNavState, '')
  }

  function openEditor(id: string) {
    setEditingId(id)
    history.pushState({ adminTab: tab, adminEditing: id } as AdminNavState, '')
  }

  function closeEditor() {
    history.back()
  }

  return (
    <div>
      <div className="flex gap-1 mb-5 border-b border-slate-200 overflow-x-auto">
        {(['queue', 'responses', 'archived', 'site', 'home', 'categories'] as const).map((t) => (
          <button
            key={t}
            onClick={() => goToTab(t)}
            className={`shrink-0 whitespace-nowrap text-sm font-medium px-3 py-2 -mb-px border-b-2 transition-colors cursor-pointer ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-slate-700'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'queue' ? (
        <ModerationQueue session={session} />
      ) : tab === 'categories' ? (
        <CategoryManager
          token={session.access_token}
          editingId={editingId}
          onOpenEditor={openEditor}
          onCloseEditor={closeEditor}
        />
      ) : tab === 'responses' ? (
        <ResponsesManager token={session.access_token} />
      ) : tab === 'archived' ? (
        <ArchivedListings token={session.access_token} />
      ) : (
        // 'site' and 'home' deliberately render the same element in the same
        // position, so switching between them keeps one mounted editor — one
        // draft, one Save button. Splitting them into two components would mean
        // two drafts of the same settings row and a way to lose unsaved work by
        // clicking a tab.
        <SiteSettingsEditor token={session.access_token} section={tab} />
      )}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Resource Moderation</h1>
      <p className="text-sm text-muted mb-6">Review and approve submitted resources.</p>
      {children}
    </main>
  )
}

const OP_META: Record<EnrichedSubmission['operation'], { label: string; cls: string }> = {
  create: { label: '➕ New listing', cls: 'bg-green-50 text-green-700 border border-green-200' },
  update: { label: '✏️ Edit', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  delete: { label: '🗑️ Removal', cls: 'bg-red-50 text-red-700 border border-red-200' },
}

function fmt(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  // Structured hours object → human-readable multi-day summary instead of [object Object].
  if (isStructuredHours(value)) return formatHoursSummary(value)
  // Structured minyanim array → "5 minyanim: Shacharis, Kabbalas Shabbos, Mincha, Maariv"
  if (isMinyanim(value)) {
    const count = value.length
    const tefillot = [...new Set(value.map((m) => TEFILLAH_LABELS[m.tefillah]))]
    return `${count} minyan${count !== 1 ? 'im' : ''}: ${tefillot.join(', ')}`
  }
  if (Array.isArray(value)) return value.join(', ') || '—'
  return String(value)
}

// Flattens a listing (current ResourceRow or proposed payload) into ordered
// label/value pairs for display and diffing.
function flatListing(src: ResourceRow | ResourceSubmission | undefined): Record<string, string> {
  if (!src) return {}
  const details = (src.details ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {
    Name: fmt(src.name),
    Address: fmt(src.address),
    Phone: fmt(src.phone),
  }
  const SKIP = new Set(['legacyId', 'geo', 'placeId', 'googleSyncedAt', 'businessStatus', 'googleDescription'])
  for (const [k, v] of Object.entries(details)) {
    if (SKIP.has(k)) continue
    out[k] = fmt(v)
  }
  return out
}

function ModerationQueue({ session }: { session: Session }) {
  const [items, setItems] = useState<EnrichedSubmission[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const token = session.access_token

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/submissions', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 401) {
        setError(`Signed in as ${session.user.email}, but this account is not an authorized admin.`)
        setItems([])
        return
      }
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.errors?.join(' ') || 'Failed to load.')
      setItems(body.submissions as EnrichedSubmission[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }, [token, session.user.email])

  useEffect(() => {
    load()
  }, [load])

  async function moderate(id: string, status: 'approved' | 'rejected', reason?: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.errors?.join(' ') || 'Failed to update.')
      setItems((prev) => (prev ? prev.filter((s) => s.id !== id) : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusyId(null)
    }
  }

  async function signOut() {
    await getBrowserClient().auth.signOut()
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

      {error && (
        <p className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 mb-4">{error}</p>
      )}

      {items === null ? (
        <p className="text-sm text-muted">Loading submissions…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">🎉 Nothing pending — the queue is clear.</p>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <SubmissionCard key={s.id} submission={s} busy={busyId === s.id} onModerate={moderate} />
          ))}
        </div>
      )}
    </div>
  )
}

function SubmissionCard({
  submission: s,
  busy,
  onModerate,
}: {
  submission: EnrichedSubmission
  busy: boolean
  onModerate: (id: string, status: 'approved' | 'rejected', reason?: string) => void
}) {
  const [pendingReject, setPendingReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const isCategory = s.target_type === 'category'
  const op = isCategory
    ? { label: '🆕 New category', cls: 'bg-purple-50 text-purple-700 border border-purple-200' }
    : OP_META[s.operation]
  const categoryLabel = s.categoryLabel ?? ''
  const title = isCategory
    ? (s.payload as CategorySubmissionPayload).label
    : (s.payload as Partial<ResourceSubmission>).name || s.current?.name || '(unknown listing)'

  function handleRejectConfirm() {
    onModerate(s.id, 'rejected', rejectReason.trim() || undefined)
    setPendingReject(false)
    setRejectReason('')
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${op.cls}`}>{op.label}</span>
            {categoryLabel && (
              <span className="text-xs font-medium bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                {categoryLabel}
              </span>
            )}
            <p className="font-semibold text-slate-900 text-sm">{title}</p>
          </div>

          {isCategory && <CategoryDetails payload={s.payload as CategorySubmissionPayload} />}
          {!isCategory && s.operation === 'create' && (
            <ProposedDetails src={s.payload as ResourceSubmission} />
          )}
          {!isCategory && s.operation === 'update' && (
            <Diff current={s.current} proposed={s.payload as ResourceSubmission} />
          )}
          {!isCategory && s.operation === 'delete' && (
            <div className="text-xs text-slate-600">
              {s.current && <p>{s.current.address}</p>}
              <p className="mt-1 text-red-700">Reported for removal{s.note ? `: "${s.note}"` : '.'}</p>
            </div>
          )}

          {(s.submitted_by?.name || s.submitted_by?.email) && (
            <p className="text-xs text-muted mt-2 italic">
              by {s.submitted_by.name || s.submitted_by.email}
            </p>
          )}

          {/* Two-step reject: reason input appears inline below the details */}
          {pendingReject && (
            <div className="mt-3 border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs font-medium text-slate-700">Reason for rejection (optional — will be included in the email to the submitter)</p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                placeholder="e.g. This location is already listed, or the address couldn't be verified…"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleRejectConfirm}
                  disabled={busy}
                  className="text-xs font-medium bg-red-600 text-white rounded px-3 py-1.5 hover:bg-red-700 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {busy ? 'Rejecting…' : 'Confirm rejection'}
                </button>
                <button
                  onClick={() => { setPendingReject(false); setRejectReason('') }}
                  disabled={busy}
                  className="text-xs font-medium border border-slate-300 text-slate-600 rounded px-3 py-1.5 hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {!pendingReject && (
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={() => onModerate(s.id, 'approved')}
              disabled={busy}
              className="text-xs font-medium bg-green-600 text-white rounded px-3 py-1.5 hover:bg-green-700 transition-colors disabled:opacity-60 cursor-pointer"
            >
              {busy ? '…' : 'Approve'}
            </button>
            <button
              onClick={() => setPendingReject(true)}
              disabled={busy}
              className="text-xs font-medium border border-slate-300 text-slate-600 rounded px-3 py-1.5 hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CategoryDetails({ payload }: { payload: CategorySubmissionPayload }) {
  const f = payload.firstListing
  // Icon / upvotes aren't collected on the suggestion form (a moderator sets
  // those on approval), so they'd always render empty here — omit them.
  const rows: [string, string][] = [
    ['Description', payload.description || '—'],
    ['First listing', f?.name || '—'],
    ['Address', f?.address || '—'],
    ['Phone', f?.phone || '—'],
  ]
  return (
    <dl className="text-xs text-slate-600 space-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="text-muted w-24 shrink-0">{k}</dt>
          <dd className="text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function ProposedDetails({ src }: { src: ResourceSubmission }) {
  const fields = flatListing(src)
  return (
    <dl className="text-xs text-slate-600 space-y-0.5">
      {Object.entries(fields).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="text-muted w-20 shrink-0">{k}</dt>
          <dd className="text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Diff({ current, proposed }: { current?: ResourceRow | null; proposed: ResourceSubmission }) {
  const before = flatListing(current ?? undefined)
  const after = flatListing(proposed)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]

  return (
    <dl className="text-xs space-y-0.5">
      {keys.map((k) => {
        const changed = before[k] !== after[k]
        return (
          <div key={k} className="flex gap-2">
            <dt className="text-muted w-20 shrink-0">{k}</dt>
            <dd className={changed ? 'text-slate-800' : 'text-slate-400'}>
              {changed ? (
                <span>
                  <span className="line-through text-red-500">{before[k] ?? '—'}</span>{' '}
                  <span aria-hidden="true">→</span>{' '}
                  <span className="text-green-700 font-medium">{after[k] ?? '—'}</span>
                </span>
              ) : (
                after[k]
              )}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
