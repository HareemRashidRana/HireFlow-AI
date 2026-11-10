import { describe, expect, it } from 'vitest'

/**
 * Requirements Coverage must stay out of the places where it could rank, hide or steer: the
 * candidate directory, the pipeline board, the applications list, the jobs list and the privacy
 * overview. These read the source, so a future import fails here, not in production.
 */
const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sources = Object.entries(files)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))
  .map(([path, source]) => [path.replace(/^\/src\//, ''), source] as const)
const source = (file: string): string => {
  const hit = sources.find(([p]) => p === file)
  if (!hit) throw new Error(`missing source file ${file}`)
  return hit[1]
}

const ALLOWED = new Set([
  'api/screening.ts',
  'types/screening.ts',
  'features/recruitment/lib/coverage.ts',
  'features/recruitment/components/RequirementsCoverageCard.tsx',
  'features/recruitment/components/CoverageDetail.tsx',
  'features/recruitment/components/CoverageReviewForm.tsx',
  'features/recruitment/components/CoverageMethodologyDialog.tsx',
  'features/recruitment/components/JobCoverageOverview.tsx',
  'features/recruitment/pages/ApplicationDetailPage.tsx',
  'features/recruitment/pages/JobDetailPage.tsx',
  'test/screeningFixtures.ts',
])

// Files that import the screening API, its types, or its helper/components.
const IMPORTS_COVERAGE = /from '[^']*(api\/screening|types\/screening|lib\/coverage|components\/(RequirementsCoverageCard|Coverage|JobCoverage))/

describe('where Requirements Coverage may appear', () => {
  it('the source tree was really scanned', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(sources.some(([p]) => p === 'api/screening.ts')).toBe(true)
  })

  it('is used by exactly the intended files', () => {
    const users = sources.filter(([, s]) => IMPORTS_COVERAGE.test(s)).map(([p]) => p)
    expect(users.filter((p) => !ALLOWED.has(p))).toEqual([])
    expect(users).toContain('features/recruitment/pages/ApplicationDetailPage.tsx')
  })

  it.each([
    'features/recruitment/components/PipelineBoard.tsx',
    'features/recruitment/pages/PipelineBoardPage.tsx',
    'features/recruitment/components/CandidateTable.tsx',
    'features/recruitment/pages/CandidatesPage.tsx',
    'features/recruitment/pages/CandidateDetailPage.tsx',
    'features/recruitment/components/ApplicationTable.tsx',
    'features/recruitment/pages/ApplicationsPage.tsx',
    'features/recruitment/components/JobTable.tsx',
    'features/recruitment/pages/JobsPage.tsx',
    'features/privacy/pages/PrivacyPage.tsx',
  ])('%s never imports, mentions or shows a coverage figure', (file) => {
    // "screening" alone is also a pipeline STAGE name, so look for the feature's own identifiers
    expect(source(file)).not.toMatch(/screeningApi|api\/screening|types\/screening|total_score|coverage|assessment/i)
  })

  it('no source file defines a sort, filter or ranking over coverage', () => {
    for (const [path, s] of sources) {
      expect(s, path).not.toMatch(/sort\([^)]*(total_score|coverage)/i)
      expect(s, path).not.toMatch(/filter\([^)]*(total_score|coverage)/i)
      expect(s, path).not.toMatch(/(minScore|maxScore|scoreThreshold|rankBy|sortByScore|orderByScore)/)
    }
  })

  it('the coverage figure is only ever read inside the coverage components', () => {
    const readers = sources.filter(([, s]) => /\.total_score\b/.test(s)).map(([p]) => p)
    expect(readers.sort()).toEqual([
      'features/recruitment/components/CoverageDetail.tsx',
      'features/recruitment/components/RequirementsCoverageCard.tsx',
    ])
  })

  it('no coverage component calls an application stage function', () => {
    for (const [path, s] of sources.filter(([p]) => /components\/(Coverage|RequirementsCoverage|JobCoverage)/.test(p))) {
      expect(s, path).not.toMatch(/changeStage|reopen|applicationsApi|stage:/)
    }
  })

  it('the coverage code never recommends, ranks or judges a person', () => {
    const banned = /(shortlist (this|the) candidate|recommended|top candidate|best candidate|good fit|poor fit|suitable|unsuitable|qualified candidate)/i
    for (const [path, s] of sources.filter(([p]) => /coverage|screening/i.test(p))) {
      expect(s, path).not.toMatch(banned)
    }
  })
})
