'use client'

import Wizard, { WizardLoading, type Answers, type Step } from './Wizard'
import posthog from 'posthog-js'
import { buildContact } from './contactSteps'
import { submitRequest } from '@/lib/submitRequest'
import { useForm } from '@/lib/useForms'
import type { FormStep } from '@/lib/forms'

// The question list itself is data-driven (see src/data/forms.js, seeded into
// the `form` table, editable from /admin's Forms tab) — this component just
// wires the collected answers into the submission payload the confirmation
// email and Google Sheet expect.

// Step ids read into named submission fields below. Anything answered under an
// id NOT in this set (i.e. a question an admin added through /admin) falls
// into `formData.extra` instead, so it still reaches the email and the sheet's
// trailing JSON column even though nothing named it ahead of time.
const KNOWN_IDS = new Set([
  'needs', 'name', 'contact', 'preferredContact', 'hospital_room',
  'meals_which', 'meals_dietary', 'meals_count', 'meals_notes',
  'ride_pickup', 'ride_dropoff', 'ride_when', 'ride_passengers', 'ride_notes',
  'stay_dates', 'stay_distance', 'stay_accessibility', 'stay_location_pref', 'stay_notes',
  'visit_type', 'visit_time', 'visit_frequency',
  'otherNeed', 'additionalInfo',
  'phone', 'email', 'company', 'turnstileToken',
])

// FormStep (loaded from the DB/fallback data as plain JSON) is structurally a
// Step, but TS can't see through the JSON boundary to know every 'single'/
// 'multi' step actually carries `options` — the admin editor and seed data
// both guarantee that invariant, so the cast is safe.
function toWizardSteps(steps: FormStep[]): Step[] {
  return steps as unknown as Step[]
}

type Props = {
  preselect?: string[]
  onClose: () => void
}

export default function SupportWizard({ preselect, onClose }: Props) {
  const form = useForm('support')
  const initial: Answers = preselect && preselect.length ? { needs: preselect } : {}

  const handleSubmit = async (a: Answers) => {
    const str = (id: string) => (typeof a[id] === 'string' ? (a[id] as string) : '')
    const arr = (id: string) => (Array.isArray(a[id]) ? (a[id] as string[]) : [])

    const hospitalRoom = str('hospital_room')
    const contact = {
      ...buildContact(a),
      // No structured hospital id anymore — store the free-typed "hospital + room"
      // here so it still shows in the admin sheet's Hospital column.
      hospitalId: hospitalRoom,
      unitFloorRoom: '',
    }

    const needs = arr('needs')
    const include = (need: string, blob: Record<string, unknown>) =>
      needs.includes(need) ? blob : undefined

    const extra: Record<string, unknown> = {}
    for (const [id, value] of Object.entries(a)) {
      if (!KNOWN_IDS.has(id) && value !== undefined && value !== '') extra[id] = value
    }

    const formData: Record<string, unknown> = {
      needs,
      hospitalRoom,
      otherNeed: str('otherNeed'),
      additionalInfo: str('additionalInfo'),
      meals: include('meals', {
        mealTypes: arr('meals_which'),
        dietaryRequirements: arr('meals_dietary'),
        numberOfPeople: str('meals_count'),
        notes: str('meals_notes'),
      }),
      transportation: include('transportation', {
        pickup: str('ride_pickup'),
        dropoff: str('ride_dropoff'),
        when: str('ride_when'),
        numberOfPassengers: str('ride_passengers'),
        notes: str('ride_notes'),
      }),
      familyHousing: include('familyHousing', {
        dates: str('stay_dates'),
        distance: str('stay_distance'),
        accessibility: str('stay_accessibility'),
        locationPreference: str('stay_location_pref'),
        notes: str('stay_notes'),
      }),
      visitors: include('visitors', {
        type: arr('visit_type'),
        timeOfDay: arr('visit_time'),
        frequency: str('visit_frequency'),
      }),
    }
    if (Object.keys(extra).length > 0) formData.extra = extra

    await submitRequest(
      'Direct Support',
      contact,
      formData,
      typeof a.company === 'string' ? a.company : '',
      typeof a.turnstileToken === 'string' ? a.turnstileToken : '',
    )
    posthog.capture('support_request_submitted', {
      need_types: needs,
    })
  }

  if (!form) return <WizardLoading onClose={onClose} />

  return (
    <Wizard
      steps={toWizardSteps(form.steps)}
      initial={initial}
      onSubmit={handleSubmit}
      onClose={onClose}
      submitLabel={form.submitLabel}
      successTitle={form.successTitle}
      successMessage={form.successMessage}
    />
  )
}
