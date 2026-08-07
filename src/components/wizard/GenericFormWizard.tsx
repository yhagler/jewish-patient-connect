'use client'

import Wizard, { WizardLoading, type Answers, type Step } from './Wizard'
import posthog from 'posthog-js'
import { buildContact } from './contactSteps'
import { submitRequest } from '@/lib/submitRequest'
import { useForm } from '@/lib/useForms'
import type { FormStep } from '@/lib/forms'

// Runs any admin-created custom form through the exact same Wizard component
// Support/Volunteer use — the DB write path (insertFormResponse) is already
// generic, so this needs no per-form code, unlike SupportWizard/VolunteerWizard
// which hand-map specific step ids for the legacy Sheets column layout.

// The shared "name / how can we reach you / preferred contact" block every
// form (built-in or custom) starts with (see DEFAULT_CONTACT_STEPS in
// formStore.ts) — captured via `contact`/buildContact, not part of the
// form's own data. `company`/`turnstileToken` are Wizard's own bookkeeping.
const RESERVED_IDS = new Set(['name', 'contact', 'phone', 'email', 'preferredContact', 'company', 'turnstileToken'])

// FormStep (loaded from the DB/fallback data as plain JSON) is structurally a
// Step, but TS can't see through the JSON boundary — see the identical cast
// in SupportWizard.tsx/VolunteerWizard.tsx.
function toWizardSteps(steps: FormStep[]): Step[] {
  return steps as unknown as Step[]
}

type Props = {
  formId: string
  onClose: () => void
}

export default function GenericFormWizard({ formId, onClose }: Props) {
  const form = useForm(formId)

  const handleSubmit = async (a: Answers) => {
    // buildContact only covers the shared name/phone/email/preferred-contact
    // block — a custom form has no hospital-picker step (that's specific to
    // Support), so those two fields are simply empty here.
    const contact = { ...buildContact(a), hospitalId: '', unitFloorRoom: '' }

    const formData: Record<string, unknown> = {}
    for (const [id, value] of Object.entries(a)) {
      if (!RESERVED_IDS.has(id) && value !== undefined && value !== '') formData[id] = value
    }

    await submitRequest(
      form!.title,
      contact,
      formData,
      typeof a.company === 'string' ? a.company : '',
      typeof a.turnstileToken === 'string' ? a.turnstileToken : '',
      formId,
    )
    posthog.capture('custom_form_submitted', { form_id: formId })
  }

  if (!form) return <WizardLoading onClose={onClose} />

  return (
    <Wizard
      steps={toWizardSteps(form.steps)}
      onSubmit={handleSubmit}
      onClose={onClose}
      submitLabel={form.submitLabel}
      successTitle={form.successTitle}
      successMessage={form.successMessage}
    />
  )
}
