'use client'

import { useRef, useState } from 'react'
import posthog from 'posthog-js'
import { fieldIsVisible, isCategorySyncEligible, selectValues, type CategoryConfig, type CategoryField } from '@/lib/categories'
import { formatPhone, normalizeUrl } from '@/lib/validation'
import type { DirectoryResource, ResourceSubmission } from '@/types'
import TagsInput from './TagsInput'
import AddressInput, { type PlaceSelectResult } from '@/components/intake/AddressInput'
import HoursInput from '@/components/intake/HoursInput'
import MinyanimInput from '@/components/intake/MinyanimInput'
import UpButton from '@/components/UpButton'
import Honeypot from '@/components/Honeypot'
import TurnstileWidget, { type TurnstileHandle } from '@/components/TurnstileWidget'

// Whether the Turnstile challenge is actually active for this deploy — mirrors
// TurnstileWidget's own check. When it's not configured, the widget renders
// nothing and never calls back with a token, so submission can't be gated on
// having one.
const TURNSTILE_ACTIVE = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

type Props = {
  /** The category this listing belongs to (fixed by where the form was opened). */
  category: CategoryConfig
  mode: 'create' | 'edit'
  /** Existing listing to pre-fill, when editing. */
  existing?: DirectoryResource
  onUp: () => void
  onSubmitted: () => void
  /** Admin-preview only: when set, Submit builds the resource locally and
   *  hands it to this callback instead of posting to /api/submissions — so
   *  the category editor's Preview can show it appearing in the directory
   *  without persisting anything. */
  onPreviewSubmit?: (resource: DirectoryResource) => void
  /** When provided, use this already-in-progress Turnstile challenge (owned by
   *  a parent that mounted it as soon as the category directory loaded)
   *  instead of rendering a fresh one here. The challenge takes a few seconds
   *  to resolve — starting it the moment the visitor lands on the category,
   *  rather than only once they open Add/Edit, means it's usually already
   *  solved by the time they hit Submit, instead of making them wait through
   *  "Verifying…" right when they open the form. Falls back to rendering its
   *  own widget (the old behavior) when omitted, e.g. in the admin preview. */
  sharedTurnstile?: { token: string; reset: () => void }
}

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary'

export default function ListingForm({ category, mode, existing, onUp, onSubmitted, onPreviewSubmit, sharedTurnstile }: Props) {
  const config = category
  const hasAddress = category.hasAddress !== false
  const hasPhone = category.hasPhone !== false
  const syncEligible = isCategorySyncEligible(category.id)

  const [name, setName] = useState(existing?.name ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [placeId, setPlaceId] = useState<string | null>(
    typeof existing?.placeId === 'string' ? existing.placeId : null,
  )
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    (existing?.geo as { lat: number; lng: number } | undefined) ?? null,
  )
  const [details, setDetails] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const field of config?.detailFields ?? []) {
      if (existing && field.key in existing) init[field.key] = existing[field.key]
      // Load companion "sometimes" array for tag fields.
      if (field.type === 'tags' && existing) {
        const sk = field.key + '_sometimes'
        if (sk in existing) init[sk] = existing[sk]
      }
    }
    return init
  })
  const [submitterName, setSubmitterName] = useState('')
  const [submitterEmail, setSubmitterEmail] = useState('')
  // Honeypot — stays empty for humans; bots that auto-fill it get dropped server-side.
  const [honeypot, setHoneypot] = useState('')
  const [ownTurnstileToken, setOwnTurnstileToken] = useState('')
  const ownTurnstileRef = useRef<TurnstileHandle>(null)
  const turnstileToken = sharedTurnstile ? sharedTurnstile.token : ownTurnstileToken
  const resetTurnstile = () => {
    if (sharedTurnstile) sharedTurnstile.reset()
    else {
      ownTurnstileRef.current?.reset()
      setOwnTurnstileToken('')
    }
  }

  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)

  // Which audience sections (Women's/Men's/Keilim, …) are expanded — purely a
  // display preference layered on top of fieldIsVisible's hard gate (a
  // section only exists here at all once its checkbox is on; this just lets
  // it be tucked away again without hiding what it means). Absent from the
  // map = expanded, so a section defaults open the moment it first appears.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

  function setDetail(key: string, value: unknown) {
    setDetails((prev) => ({ ...prev, [key]: value }))
  }

  function handlePlaceSelect(result: PlaceSelectResult) {
    if (syncEligible) setPlaceId(result.placeId)
    // Always overwrite — if you switch from "Trader Joe's" to "Giant", all
    // auto-filled fields should update to match the new selection.
    if (result.name) setName(result.name)
    if (result.phone) setPhone(formatPhone(result.phone))
    if (result.hours) {
      const hoursField = config.detailFields.find((f) => f.type === 'hours')
      if (hoursField) setDetail(hoursField.key, result.hours)
    }
    if (result.website) {
      // Matched by label, not key — existing categories' Website fields
      // predate a fixed key convention (e.g. keyed "w" or "whatsapp"), so
      // matching on the label people actually see is the reliable signal.
      const websiteField = config.detailFields.find(
        (f) => f.type === 'url' && f.label.trim().toLowerCase() === 'website',
      )
      if (websiteField) setDetail(websiteField.key, result.website)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors([])

    // Only submit values for fields that are actually shown (respects showIf and
    // community categories that hide hospital/address/distance/phone).
    const visibleDetails: Record<string, unknown> = {}
    for (const field of config.detailFields) {
      if (fieldIsVisible(field, details)) {
        visibleDetails[field.key] = details[field.key]
        // Carry the companion "sometimes" array for tag fields.
        if (field.type === 'tags') {
          visibleDetails[field.key + '_sometimes'] = details[field.key + '_sometimes'] ?? []
        }
      }
    }

    if (onPreviewSubmit) {
      onPreviewSubmit({
        id: existing?.id ?? `preview-${Date.now()}`,
        category: category.id,
        name,
        anchorId: hasAddress ? 'all' : 'community',
        distance: 0,
        address: hasAddress ? address : '',
        phone: hasPhone ? phone : '',
        geo: hasAddress ? coords : null,
        ...visibleDetails,
      })
      return
    }

    const payload: ResourceSubmission = {
      category: category.id,
      name,
      // Listings aren't hospital-scoped; distance is computed from the geocoded
      // address. `anchorId` is just a grouping key ('community' for categories
      // with no address at all; 'all' otherwise).
      anchorId: hasAddress ? 'all' : 'community',
      distance: null,
      address: hasAddress ? address : '',
      phone: hasPhone ? phone : '',
      details: {
        ...visibleDetails,
        // Carry the Google place id through so the sync job can pick it up as
        // soon as the listing is approved. Only set for sync-eligible categories.
        ...(syncEligible && placeId ? { placeId } : {}),
      },
      geo: hasAddress ? coords : null,
    }
    const submittedBy =
      submitterName.trim() || submitterEmail.trim()
        ? { name: submitterName.trim() || undefined, email: submitterEmail.trim() || undefined }
        : undefined

    setSubmitting(true)
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: mode === 'edit' ? 'update' : 'create',
          targetType: 'listing',
          targetId: mode === 'edit' ? existing?.id : undefined,
          payload,
          submittedBy,
          company: honeypot,
          turnstileToken,
        }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) {
        // Turnstile tokens are single-use and expire after ~5 min — on a form
        // with this many fields (especially editing, reviewing everything
        // already filled in) it's easy to take longer than that before
        // hitting Submit. The server's message tells the visitor to refresh
        // the page, which would lose everything they just filled in — instead,
        // silently re-run the challenge for a fresh token so a plain second
        // tap on Submit (no reload needed) just works.
        if (res.status === 403) {
          resetTurnstile()
          setErrors(['Verification expired. We’ve refreshed it — please tap Submit again.'])
          return
        }
        setErrors(body.errors ?? ['Something went wrong. Please try again.'])
        return
      }
      posthog.capture(mode === 'edit' ? 'listing_submission_updated' : 'listing_submission_created', {
        category_id: category.id,
      })
      setDone(true)
    } catch {
      setErrors(['Network error. Please check your connection and try again.'])
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div>
        <UpButton label={config.pluralLabel} onClick={onSubmitted} />
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <p className="text-2xl mb-2">🙏</p>
          <h2 className="text-lg font-semibold text-green-800 mb-1">Thank you!</h2>
          <p className="text-sm text-green-700">
            Your {mode === 'edit' ? 'suggested edit' : 'submission'} was received and will appear once
            it&apos;s reviewed and approved.
          </p>
        </div>
      </div>
    )
  }

  const heading =
    mode === 'edit' ? 'Suggest an edit' : `Add a ${config?.label ?? 'listing'}`

  return (
    <div>
      <UpButton label={config.pluralLabel} onClick={onUp} />

      <h2 className="text-xl font-semibold text-slate-800 mb-1">{heading}</h2>
      <p className="text-sm text-muted mb-5">
        {mode === 'edit'
          ? 'Change what’s wrong below. Edits are reviewed before they go live.'
          : 'New listings are reviewed before they appear on the site.'}
      </p>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Honeypot value={honeypot} onChange={setHoneypot} />
        {hasAddress && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address *</label>
            <AddressInput
              value={address}
              onChange={setAddress}
              onCoords={setCoords}
              onPlaceSelect={handlePlaceSelect}
              placeholder={syncEligible ? 'Search by business name or address…' : 'Start typing an address…'}
              disableAutocomplete={!!onPreviewSubmit}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Kosher Mart" />
        </div>

        {hasPhone && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} className={inputClass} placeholder="(215) 555-0100" />
          </div>
        )}

        {config.detailFields.some((f) => fieldIsVisible(f, details)) && (
          <div className="space-y-4 border-t border-slate-200 pt-4">
            {(() => {
              const visible = config.detailFields.filter((field) => fieldIsVisible(field, details))

              // Group into ungrouped fields and audience sections — see
              // CategoryField.audienceKey. A section renders where its FIRST
              // field appears (stable, not necessarily contiguous), so a
              // mikvah's separate men's/women's/keilim hours & contact info
              // read as named groups instead of one long undifferentiated
              // list. `visible` already dropped every audience whose checkbox
              // isn't on (fieldIsVisible), so a section only ever appears at
              // all once it applies — nothing to manually reveal.
              type Block =
                | { kind: 'field'; field: CategoryField }
                | { kind: 'section'; audienceKey: string; label: string; fields: CategoryField[] }
              const blocks: Block[] = []
              const sectionAt = new Map<string, number>()
              for (const field of visible) {
                if (!field.audienceKey) {
                  blocks.push({ kind: 'field', field })
                  continue
                }
                const at = sectionAt.get(field.audienceKey)
                const existingBlock = at !== undefined ? blocks[at] : undefined
                if (existingBlock?.kind === 'section') {
                  existingBlock.fields.push(field)
                } else {
                  sectionAt.set(field.audienceKey, blocks.length)
                  // filterLabel is the short form ("Women's") the filter chip
                  // already uses; label ("Women's Tevillah") is the fallback
                  // for a boolean that has no filterLabel set.
                  const audienceField = config.detailFields.find((f) => f.key === field.audienceKey)
                  const label = audienceField?.filterLabel ?? audienceField?.label ?? field.audienceKey
                  blocks.push({ kind: 'section', audienceKey: field.audienceKey, label, fields: [field] })
                }
              }

              const renderField = (field: CategoryField, labelOverride?: string) => (
                <DetailFieldInput
                  key={field.key}
                  field={field}
                  labelOverride={labelOverride}
                  value={details[field.key]}
                  onChange={(v) => setDetail(field.key, v)}
                  sometimes={field.type === 'tags' ? ((details[field.key + '_sometimes'] as string[] | undefined) ?? []) : undefined}
                  onChangeSometimes={field.type === 'tags' ? (v) => setDetail(field.key + '_sometimes', v) : undefined}
                />
              )

              return blocks.map((block) => {
                if (block.kind === 'field') return renderField(block.field)

                // Prefixed so this can never collide with a field's own key —
                // the audienceKey is itself a field's key (the checkbox this
                // section is scoped to), so an unprefixed key here would
                // duplicate that field's `key={field.key}` below.
                const sectionKey = `section:${block.audienceKey}`
                const open = !collapsedSections[sectionKey]
                return (
                  <div key={sectionKey} className="border border-slate-200 rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setCollapsedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))}
                      aria-expanded={open}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">{block.label}</span>
                      <svg
                        className={`w-3.5 h-3.5 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {open && (
                      <div className="p-3 space-y-4">
                        {block.fields.map((field) => renderField(field, field.shortLabel))}
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-200 pt-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Your name (optional)</label>
            <input value={submitterName} onChange={(e) => setSubmitterName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Your email (optional)</label>
            <input type="email" value={submitterEmail} onChange={(e) => setSubmitterEmail(e.target.value)} className={inputClass} />
          </div>
        </div>

        {errors.length > 0 && (
          <ul className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700 list-disc list-inside space-y-0.5">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}

        {!sharedTurnstile && <TurnstileWidget ref={ownTurnstileRef} onVerify={setOwnTurnstileToken} />}

        {/* Disabled until a token is actually in hand (when Turnstile is
            configured) — otherwise a visitor who fills the form faster than
            the background challenge completes could submit with an empty
            token and get rejected for no visible reason. */}
        <button
          type="submit"
          disabled={submitting || (TURNSTILE_ACTIVE && !turnstileToken)}
          className="w-full sm:w-auto bg-primary text-white font-medium px-5 py-2.5 rounded-md hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {submitting
            ? 'Submitting…'
            : TURNSTILE_ACTIVE && !turnstileToken
              ? 'Verifying…'
              : mode === 'edit'
                ? 'Submit edit for review'
                : 'Submit for review'}
        </button>
      </form>
      </div>
    </div>
  )
}

function DetailFieldInput({
  field,
  labelOverride,
  value,
  onChange,
  sometimes,
  onChangeSometimes,
}: {
  field: CategoryField
  /** Shown instead of field.label — used inside an audience section so
   *  "Women's Phone" reads as just "Phone" under the "Women's" heading. */
  labelOverride?: string
  value: unknown
  onChange: (value: unknown) => void
  sometimes?: string[]
  onChangeSometimes?: (v: string[]) => void
}) {
  const label = `${labelOverride ?? field.label}${field.required ? ' *' : ''}`

  if (field.type === 'tags') {
    return (
      <TagsInput
        field={field}
        value={(value as string[]) ?? []}
        onChange={onChange}
        sometimes={sometimes}
        onChangeSometimes={onChangeSometimes}
      />
    )
  }

  if (field.type === 'url') {
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
        <input
          type="url"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          // Adds "https://" once they're done typing — almost nobody types the
          // scheme by hand, but doing this on every keystroke (instead of on
          // blur) would fight typing/pasting a real https:// URL mid-edit.
          onBlur={(e) => onChange(normalizeUrl(e.target.value))}
          placeholder={field.placeholder ?? 'example.com'}
          className={inputClass}
        />
        {field.help && <p className="text-xs text-muted mt-1">{field.help}</p>}
      </div>
    )
  }

  if (field.type === 'boolean') {
    return (
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
          />
          <span className="text-sm font-medium text-slate-700">{labelOverride ?? field.label}</span>
        </label>
        {field.help && <p className="text-xs text-muted mt-1 ml-6">{field.help}</p>}
      </div>
    )
  }

  if (field.type === 'hours') {
    return <HoursInput label={label} value={value} onChange={onChange} />
  }

  if (field.type === 'minyanim') {
    return <MinyanimInput label={label} value={value} onChange={onChange} />
  }

  if (field.type === 'textarea') {
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
        <textarea value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={field.placeholder} className={inputClass} />
        {field.help && <p className="text-xs text-muted mt-1">{field.help}</p>}
      </div>
    )
  }

  if (field.type === 'select' && field.multiSelect) {
    // Badge-shown choice fields always allow more than one value on a single
    // listing (e.g. a place that's both a Restaurant and a Caterer) — see
    // `selectValues` for why the stored shape can still be a bare string on
    // older listings.
    const chosen = selectValues(value)
    function toggle(v: string) {
      onChange(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v])
    }
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => {
            const on = chosen.includes(opt.value)
            return (
              <label
                key={opt.value}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                  on ? 'border-primary bg-primary/10 text-primary' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(opt.value)} className="sr-only" />
                {opt.label}
              </label>
            )
          })}
        </div>
        {field.help && <p className="text-xs text-muted mt-1">{field.help}</p>}
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
        <select value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.help && <p className="text-xs text-muted mt-1">{field.help}</p>}
      </div>
    )
  }

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={field.type === 'number' ? 'number' : field.type === 'tel' ? 'tel' : 'text'}
        value={(value as string) ?? ''}
        onChange={(e) =>
          onChange(
            field.type === 'number'
              ? Number(e.target.value)
              // Same live formatting as the main Phone field (see formatPhone)
              // — a category's own "Women's Phone"-style field shouldn't look
              // different just because it isn't the built-in one.
              : field.type === 'tel'
                ? formatPhone(e.target.value)
                : e.target.value,
          )
        }
        placeholder={field.placeholder}
        className={inputClass}
      />
      {field.help && <p className="text-xs text-muted mt-1">{field.help}</p>}
    </div>
  )
}
