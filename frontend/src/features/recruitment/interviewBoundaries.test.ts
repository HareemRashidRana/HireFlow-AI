import { describe, expect, it } from 'vitest'

/**
 * Interviews are scheduling and human feedback only. They must not rank, score or steer: no
 * Requirements Coverage, no application-stage changes, no AI, no sorting by a rating. These read
 * the source, so a future change fails here, not in production.
 */
const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
/** Comments may say what the code does NOT do, so only code is scanned. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const sources = Object.entries(files)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))
  .map(([path, source]) => [path.replace(/^\/src\//, ''), stripComments(source)] as const)

const interviewFiles = sources.filter(([p]) => /(^|\/)(interview|Interview|Feedback|ApplicationInterviews|Schedule|Reschedule|CancelInterview)/.test(p) && !p.startsWith('test/'))

describe('interview module boundaries', () => {
  it('the source tree was really scanned and the interview files found', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(interviewFiles.length).toBeGreaterThan(15)
  })

  it('never imports Requirements Coverage or screening', () => {
    for (const [p, s] of interviewFiles) expect(s, p).not.toMatch(/api\/screening|types\/screening|lib\/coverage|RequirementsCoverage|Coverage(Detail|Review)/)
  })

  it('never changes an application stage', () => {
    for (const [p, s] of interviewFiles) expect(s, p).not.toMatch(/applicationsApi\.(move|changeStage|setStage|reject|hire|withdraw)|\/stage/)
  })

  it('has no AI, scoring, ranking or sort-by-rating code', () => {
    for (const [p, s] of interviewFiles) {
      expect(s, p).not.toMatch(/\b(sort_by|sortBy|order_by|orderBy)\b/)
      expect(s, p).not.toMatch(/\b(leaderboard|rankings?|auto-?score|ai[- ]generated|recommend(ed)? (candidate|hire))\b/i)
      expect(s, p).not.toMatch(/\.sort\([^)]*rating/)
    }
  })

  it('no interview component sets an average or total of ratings', () => {
    for (const [p, s] of interviewFiles) expect(s, p).not.toMatch(/\b(average|averageRating|avgRating|meanRating|totalScore)\b/)
  })

  it('only the application page and the interview pages use the interview card or dialog', () => {
    const users = sources.filter(([, s]) => /from '[^']*(ApplicationInterviewsCard|ScheduleInterviewDialog)'/.test(s)).map(([p]) => p).sort()
    expect(users).toEqual([
      'features/recruitment/components/ApplicationInterviewsCard.tsx',
      'features/recruitment/pages/ApplicationDetailPage.tsx',
      'features/recruitment/pages/InterviewsPage.tsx',
    ])
  })

  it('the candidate directory, pipeline and jobs list do not import interview code', () => {
    for (const file of ['features/recruitment/pages/CandidatesPage.tsx', 'features/recruitment/pages/ApplicationsPage.tsx', 'features/recruitment/pages/JobsPage.tsx']) {
      const hit = sources.find(([p]) => p === file)
      if (hit) expect(hit[1], file).not.toMatch(/api\/interviews|types\/interview|lib\/interviews/)
    }
  })
})
