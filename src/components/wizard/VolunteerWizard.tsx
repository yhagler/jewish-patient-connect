'use client'

import { useMemo } from 'react'
import posthog from 'posthog-js'
import Wizard, { WizardLoading, type Answers, type Step } from './Wizard'
import { buildContact } from './contactSteps'
import { submitRequest } from '@/lib/submitRequest'
import { useForm } from '@/lib/useForms'
import { useHospitals } from '@/lib/useHospitals'
import type { FormStep } from '@/lib/forms'
import type { Hospital } from '@/types'
import { community } from '@/community.config'

const ANYWHERE = 'anywhere'

// The question list itself is data-driven (see src/data/forms.js, seeded into
// the `form` table, editable from /admin's Forms tab) — this component just
// resolves the one step whose options come from live data (not something to
// store/edit as text) and wires the collected answers into the submission
// payload the Volunteers sheet tab expects.

// Step ids read into named submission fields below. Anything answered under an
// id NOT in this set (i.e. a question an admin added through /admin) falls
// into `formData.extra` instead, so it still reaches the sheet's trailing JSON
// column even though nothing named it ahead of time.
const KNOWN_IDS = new Set([
  'waysToHelp', 'name', 'contact', 'preferredContact',
  'meals_kosher',
  'visit_days', 'visit_time', 'visit_gender', 'visit_age',
  'ride_passengers',
  'host_rooms', 'host_beds', 'host_address',
  'waysToHelpOther', 'areas', 'notes',
  'phone', 'email', 'company', 'turnstileToken',
])

// FormStep (loaded from the DB/fallback data as plain JSON) is structurally a
// Step, but TS can't see through the JSON boundary to know every 'single'/
// 'multi' step actually carries `options` — the admin editor and seed data
// both guarantee that invariant, so the cast is safe.
function toWizardSteps(steps: FormStep[], hospitals: Hospital[]): Step[] {
  const resolved = steps.map((s) =>
    s.optionsSource === 'hospitals'
      ? {
          ...s,
          options: [
            ...hospitals.map((h) => ({ value: h.id, label: h.name })),
            { value: ANYWHERE, label: `Anywhere in the ${community.region} area` },
          ],
        }
      : s,
  )
  return resolved as unknown as Step[]
}

type Props = {
  preselect?: string[]
  onClose: () => void
}

export default function VolunteerWizard({ preselect, onClose }: Props) {
  const form = useForm('volunteer')
  const hospitals = useHospitals() ?? []
  const steps = useMemo(() => (form ? toWizardSteps(form.steps, hospitals) : []), [form, hospitals])
  const initial: Answers = preselect && preselect.length ? { waysToHelp: preselect } : {}

  const handleSubmit = async (a: Answers) => {
    const str = (id: string) => (typeof a[id] === 'string' ? (a[id] as string) : '')
    const arr = (id: string) => (Array.isArray(a[id]) ? (a[id] as string[]) : [])

    const contact = { ...buildContact(a), hospitalId: '', unitFloorRoom: '' }

    const extra: Record<string, unknown> = {}
    for (const [id, value] of Object.entries(a)) {
      if (!KNOWN_IDS.has(id) && value !== undefined && value !== '') extra[id] = value
    }

    // Volunteer signups land in the "Volunteers" sheet tab, which reads these
    // top-level fields (the rest is kept verbatim in the trailing JSON column).
    const volunteer: Record<string, unknown> = {
      waysToHelp: arr('waysToHelp'),
      waysToHelpOther: str('waysToHelpOther'),
      hospitals: arr('areas'),
      availability: [],
      hasCar: '',
      notes: str('notes'),
      meals: { kosherStandard: str('meals_kosher') },
      visiting: {
        days: arr('visit_days'),
        timeOfDay: arr('visit_time'),
        gender: str('visit_gender'),
        ageGroup: str('visit_age'),
      },
      transportation: { maxPassengers: str('ride_passengers') },
      housing: {
        numberOfRooms: str('host_rooms'),
        numberOfBeds: str('host_beds'),
        address: str('host_address'),
      },
    }
    if (Object.keys(extra).length > 0) volunteer.extra = extra

    await submitRequest('Volunteer', contact, volunteer, str('company'), str('turnstileToken'))
    posthog.capture('volunteer_signup_submitted', {
      ways_to_help: arr('waysToHelp'),
    })
  }

  if (!form) return <WizardLoading onClose={onClose} />

  return (
    <Wizard
      steps={steps}
      initial={initial}
      onSubmit={handleSubmit}
      onClose={onClose}
      submitLabel={form.submitLabel}
      successTitle={form.successTitle}
      successMessage={form.successMessage}
    />
  )
}
