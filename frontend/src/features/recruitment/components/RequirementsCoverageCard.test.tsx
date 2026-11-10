// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../api/errors'
import { makeAssessment, makeScreening, makeSummary, methodology } from '../../../test/screeningFixtures'
import { renderAs } from '../../../test/render'
import type { UserRole } from '../../../types/auth'
import { RequirementsCoverageCard } from './RequirementsCoverageCard'

const api = { forApplication: vi.fn(), create: vi.fn(), get: vi.fn(), review: vi.fn(), methodology: vi.fn(), forJob: vi.fn() }
vi.mock('../../../api/screening', () => ({
  screeningApi: Object.fromEntries(['forApplication', 'create', 'get', 'review', 'methodology', 'forJob'].map((k) => [k, (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a)])),
}))

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.methodology.mockResolvedValue(methodology)
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
})

function render(role: UserRole = 'recruiter') {
  const view = renderAs(<RequirementsCoverageCard applicationId="app-1" candidateId="cand-1" />, { role })
  return { ...view, user: userEvent.setup() }
}
const withItems = (...summaries: ReturnType<typeof makeSummary>[]) =>
  api.forApplication.mockResolvedValue(makeScreening({ items: summaries, total: summaries.length }))

describe('who sees it', () => {
  it.each(['admin', 'hr_manager', 'recruiter'] as const)('%s sees the card', async (role) => {
    api.forApplication.mockResolvedValue(makeScreening())
    render(role)
    expect(await screen.findByRole('heading', { name: 'Requirements Coverage' })).toBeTruthy()
  })

  it('an employee sees nothing and nothing is requested', () => {
    render('employee')
    expect(screen.queryByText('Requirements Coverage')).toBeNull()
    expect(api.forApplication).not.toHaveBeenCalled()
  })

  it('always shows the advisory statement', async () => {
    api.forApplication.mockResolvedValue(makeScreening())
    render()
    expect(await screen.findByText(/It is advisory information for a person to interpret/)).toBeTruthy()
    expect(screen.getByText(/never changes the application's stage/)).toBeTruthy()
  })
})

describe('empty and blocked states', () => {
  it('ready but never assessed: an empty state and the assess button', async () => {
    api.forApplication.mockResolvedValue(makeScreening())
    render()
    expect(await screen.findByText(/No assessment yet/)).toBeTruthy()
    expect(screen.getByText(/3 required and 1 preferred skill/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Assess Requirements Coverage' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each([
    ['no_active_resume', 'This candidate has no active resume. Upload a resume first.'],
    ['resume_not_reviewed', 'The active resume has not been reviewed yet. Review its details first: automatic readings that nobody reviewed are never used.'],
  ] as const)('%s disables assessing, explains why and links to the resumes', async (blocker, text) => {
    api.forApplication.mockResolvedValue(makeScreening({ readiness: { can_assess: false, blocker, blocker_text: text } }))
    render()
    expect(await screen.findByText(text)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Assess Requirements Coverage' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: "Go to the candidate's resumes" }).getAttribute('href')).toBe('/recruitment/candidates/cand-1')
  })

  it('an anonymized candidate gets the reason but no link', async () => {
    api.forApplication.mockResolvedValue(makeScreening({ readiness: { can_assess: false, blocker: 'candidate_anonymized', blocker_text: 'This candidate was anonymized, so no new assessment can be made.' } }))
    render()
    expect(await screen.findByText(/was anonymized/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /resumes/ })).toBeNull()
  })

  it('shows an error with a retry', async () => {
    api.forApplication.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce(makeScreening())
    const { user } = render()
    expect(await screen.findByText(/Couldn't load Requirements Coverage/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/No assessment yet/)).toBeTruthy()
  })
})

describe('creating an assessment', () => {
  it('asks for confirmation first and creates nothing until confirmed', async () => {
    api.forApplication.mockResolvedValue(makeScreening())
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'Assess Requirements Coverage' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Assess Requirements Coverage?')).toBeTruthy()
    expect(within(dialog).getByText(/does not change the application's stage, and is recorded in the audit log/)).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.create).not.toHaveBeenCalled()
  })

  it('confirming creates it, shows it and refreshes the list', async () => {
    api.forApplication.mockResolvedValueOnce(makeScreening()).mockResolvedValue(makeScreening({ items: [makeSummary()], total: 1 }))
    api.create.mockResolvedValue(makeAssessment())
    api.get.mockResolvedValue(makeAssessment())
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'Assess Requirements Coverage' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Assess' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('app-1'))
    expect(await screen.findByText('46.7')).toBeTruthy()
    expect(await screen.findByText('Requirements Coverage assessed.')).toBeTruthy()
    expect(api.forApplication).toHaveBeenCalledTimes(2)
  })

  it('says so when an identical assessment already existed', async () => {
    api.forApplication.mockResolvedValue(makeScreening({ items: [makeSummary()], total: 1 }))
    api.get.mockResolvedValue(makeAssessment())
    api.create.mockResolvedValue(makeAssessment({ created: false }))
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'Assess again' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Assess' }))
    expect(await screen.findByText(/identical assessment already exists/)).toBeTruthy()
  })

  it('shows the server message and keeps the dialog open when creating fails', async () => {
    api.forApplication.mockResolvedValue(makeScreening())
    api.create.mockRejectedValue(new ApiError('The active resume has not been reviewed yet.', 409))
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'Assess Requirements Coverage' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Assess' }))
    expect(await within(dialog).findByText('The active resume has not been reviewed yet.')).toBeTruthy()
  })
})

describe('showing a result', () => {
  it('shows the figure, basis, criteria, evidence labels and context without any verdict', async () => {
    withItems(makeSummary())
    api.get.mockResolvedValue(makeAssessment())
    render()
    expect(await screen.findByText('46.7')).toBeTruthy()
    expect(screen.getByText(/Based on 100 of 100 weight. Advisory only./)).toBeTruthy()
    expect(screen.getByText('1 of 3 listed in the reviewed resume · 26.7 points')).toBeTruthy()
    expect(screen.getByText('1 of 1 listed in the reviewed resume · 20.0 points')).toBeTruthy()
    expect(screen.getAllByText('Not listed (2)').length).toBe(1)
    expect(screen.getByText(/resume says "JS", a known alternative name/)).toBeTruthy()
    expect(screen.getByText(/Dated experience \(context only\):/)).toBeTruthy()
    expect(screen.getByText(/8 years 7 months/)).toBeTruthy()
    expect(screen.getAllByText(/not a relevance assessment/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/"Not listed" only means the reviewed resume does not name it/).length).toBe(2)
  })

  it('an unscored result explains why instead of showing a figure', async () => {
    withItems(makeSummary({ status: 'unscored', total_score: null, assessed_weight: 0 }))
    api.get.mockResolvedValue(makeAssessment({
      status: 'unscored', total_score: null, assessed_weight: 0,
      explanation: 'No Requirements Coverage figure was calculated. The reviewed resume does not list any skills, so there is nothing to compare. This says nothing about the candidate\'s skills.',
      criteria: [
        { key: 'required_skills', label: 'Required skills', nominal_weight: 80, effective_weight: null, status: 'not_assessed', reason_code: 'no_reviewed_skills', reason: 'The reviewed resume does not list any skills, so there is nothing to compare. This says nothing about the candidate\'s skills.', listed: 0, total: 0, points: null, evidence: [] },
      ],
      unlisted_requirements: [],
    }))
    render()
    expect(await screen.findByText('No figure calculated')).toBeTruthy()
    expect(screen.getAllByText(/says nothing about the candidate's skills/).length).toBeGreaterThan(0)
    expect(screen.queryByText('/ 100')).toBeNull()
  })

  it('an outdated assessment is clearly flagged with the reasons and keeps showing its own result', async () => {
    withItems(makeSummary({ freshness: 'outdated' }))
    api.get.mockResolvedValue(makeAssessment({ freshness: { state: 'outdated', reasons: ['job_requirements_changed'], reason_texts: ["The job's skill requirements changed after this was assessed."] } }))
    render()
    expect(await screen.findByText('This assessment is outdated.')).toBeTruthy()
    expect(screen.getByText("The job's skill requirements changed after this was assessed.")).toBeTruthy()
    expect(screen.getByText(/Assess again to compare with the current inputs; the earlier result is kept/)).toBeTruthy()
    expect(screen.getByText('46.7')).toBeTruthy()
    expect(screen.getByText('The latest assessment is outdated.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Assess again' })).toBeTruthy()
  })

  it('a scrubbed assessment keeps its numbers, drops evidence and offers no review form', async () => {
    withItems(makeSummary({ freshness: 'scrubbed', scrubbed: true }))
    api.get.mockResolvedValue(makeAssessment({
      scrubbed: true, scrub_reason: 'anonymized', freshness: { state: 'scrubbed', reasons: [], reason_texts: [] },
      experience: null, unlisted_requirements: [],
      criteria: makeAssessment().criteria.map((c) => ({ ...c, evidence: null })),
    }))
    render()
    expect(await screen.findByText(/were removed when the candidate was anonymized/)).toBeTruthy()
    expect(screen.getByText('46.7')).toBeTruthy()
    expect(screen.getAllByText('The skill-by-skill details were removed.').length).toBe(2)
    expect(screen.queryByText('Add your review')).toBeNull()
    expect(screen.queryByText(/Dated experience/)).toBeNull()
  })

  it('shows previous assessments and switches between them', async () => {
    api.forApplication.mockResolvedValue(makeScreening({
      items: [makeSummary({ id: 'asm-2', assessment_number: 2, total_score: 80, freshness: 'current' }), makeSummary({ id: 'asm-1', freshness: 'outdated' })],
      total: 2,
    }))
    api.get.mockImplementation(async (id: string) => (id === 'asm-2' ? makeAssessment({ id: 'asm-2', assessment_number: 2, total_score: 80 }) : makeAssessment()))
    const { user } = render()
    expect(await screen.findByText('80.0')).toBeTruthy()
    const history = screen.getByRole('navigation', { name: 'Assessment history' })
    expect(within(history).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    await user.click(within(history).getByRole('button', { name: /#1/ }))
    expect(await screen.findByText('46.7')).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('asm-1', expect.anything())
  })

  it('a failed detail load has its own retry', async () => {
    withItems(makeSummary())
    api.get.mockRejectedValueOnce(new ApiError('nope', 500)).mockResolvedValueOnce(makeAssessment())
    const { user } = render()
    expect(await screen.findByText(/Couldn't load this assessment/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('46.7')).toBeTruthy()
  })

  it('renders hostile text from a note and a skill name as plain text', async () => {
    withItems(makeSummary({ review_count: 1 }))
    api.get.mockResolvedValue(makeAssessment({
      criteria: makeAssessment().criteria.map((c) => c.key === 'required_skills' ? { ...c, evidence: [{ requirement: '<img src=x onerror=alert(1)>', status: 'not listed' as const, matched_text: null, matched_via: null }] } : c),
      reviews: [{ id: 'r1', judgement: 'unsure', adjustments: null, adjustment_reason: null, adjusted_total: null, note: '<script>alert(1)</script>', reviewer: { id: 'u', email: 'hr@example.com', role: 'hr_manager' }, created_at: '2026-11-10T10:00:00Z', scrubbed: false }],
    }))
    render()
    expect(await screen.findByText('<script>alert(1)</script>')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('shows reviews with an adjusted figure beside the unchanged original', async () => {
    withItems(makeSummary({ review_count: 1 }))
    api.get.mockResolvedValue(makeAssessment({
      reviews: [{ id: 'r1', judgement: 'disagree', adjustments: ['Docker'], adjustment_reason: 'evidenced_elsewhere', adjusted_total: 73.3, note: 'Seen in the project list', reviewer: { id: 'u', email: 'hr@example.com', role: 'hr_manager' }, created_at: '2026-11-10T10:00:00Z', scrubbed: false }],
    }))
    render()
    expect(await screen.findByText('Disagrees')).toBeTruthy()
    expect(screen.getByText('73.3')).toBeTruthy()
    expect(screen.getByText(/original 46.7, unchanged/)).toBeTruthy()
    expect(screen.getByText('Seen in the project list')).toBeTruthy()
  })
})

describe('the methodology', () => {
  it('opens from the card, states the weights and the limits, and mentions version-suffixed names', async () => {
    api.forApplication.mockResolvedValue(makeScreening())
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'How is this calculated?' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/Weights: required skills 80%, preferred skills 20%/)).toBeTruthy()
    expect(within(dialog).getByText('What is not used')).toBeTruthy()
    expect(within(dialog).getByText(/Python 3.11/)).toBeTruthy()
    expect(within(dialog).getByText(/Methodology coverage-1.0, alias table aliases-1/)).toBeTruthy()
  })

  it('shows an error and retry when the methodology cannot be loaded', async () => {
    api.forApplication.mockResolvedValue(makeScreening())
    api.methodology.mockRejectedValueOnce(new ApiError('down', 500)).mockResolvedValueOnce(methodology)
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'How is this calculated?' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('down')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))
    expect(await within(dialog).findByText(/Weights:/)).toBeTruthy()
  })
})

describe('wording', () => {
  it('nothing on the card uses evaluative language about the candidate', async () => {
    withItems(makeSummary())
    api.get.mockResolvedValue(makeAssessment())
    const { container } = render()
    await screen.findByText('46.7')
    const text = container.textContent ?? ''
    for (const banned of [/suitab/i, /quality/i, /recommend/i, /\brank/i, /\bbest\b/i, /\bstrong\b/i, /\bweak\b/i, /\blacks?\b/i, /unqualified/i, /match score/i, /shortlist(?!.*hire anyone)/i]) {
      expect(text).not.toMatch(banned)
    }
    expect(container.querySelector('[class*="emerald"], [class*="green"]')).toBeNull() // no green "good" colouring
  })
})
