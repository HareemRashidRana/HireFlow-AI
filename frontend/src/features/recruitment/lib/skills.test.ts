import { describe, expect, it } from 'vitest'
import { MAX_SKILLS, MAX_SKILL_LENGTH, addSkills, removeSkill } from './skills'

describe('addSkills', () => {
  it('adds a single skill', () => {
    expect(addSkills([], 'Python')).toEqual({ skills: ['Python'], error: null })
  })

  it('splits on commas, semicolons and new lines', () => {
    expect(addSkills([], 'python, sql;react\ndocker').skills).toEqual(['python', 'sql', 'react', 'docker'])
  })

  it('trims, collapses inner spaces and drops blanks', () => {
    expect(addSkills([], '  machine   learning , , ,  ').skills).toEqual(['machine learning'])
  })

  it('ignores duplicates case-insensitively and keeps the first spelling', () => {
    expect(addSkills(['Python'], 'python, PYTHON, SQL, sql').skills).toEqual(['Python', 'SQL'])
  })

  it('does not mutate the existing list', () => {
    const current = ['Go']
    addSkills(current, 'Rust')
    expect(current).toEqual(['Go'])
  })

  it('rejects a skill that is too long but keeps the valid ones', () => {
    const long = 'x'.repeat(MAX_SKILL_LENGTH + 1)
    const result = addSkills([], `ok, ${long}, fine`)
    expect(result.skills).toEqual(['ok', 'fine'])
    expect(result.error).toMatch(/at most 50 characters/)
  })

  it('accepts a skill of exactly the maximum length', () => {
    const exact = 'x'.repeat(MAX_SKILL_LENGTH)
    expect(addSkills([], exact)).toEqual({ skills: [exact], error: null })
  })

  it(`stops at ${MAX_SKILLS} skills and reports it`, () => {
    const full = Array.from({ length: MAX_SKILLS }, (_, i) => `skill${i}`)
    const result = addSkills(full, 'one-too-many')
    expect(result.skills).toHaveLength(MAX_SKILLS)
    expect(result.error).toMatch(/at most 30/)
  })

  it('fills up to the limit when pasting many', () => {
    const many = Array.from({ length: 40 }, (_, i) => `s${i}`).join(',')
    const result = addSkills([], many)
    expect(result.skills).toHaveLength(MAX_SKILLS)
    expect(result.error).not.toBeNull()
  })

  it('returns the list unchanged for empty input', () => {
    expect(addSkills(['a'], '  ,  ')).toEqual({ skills: ['a'], error: null })
  })
})

describe('removeSkill', () => {
  it('removes by index without touching the original', () => {
    const skills = ['a', 'b', 'c']
    expect(removeSkill(skills, 1)).toEqual(['a', 'c'])
    expect(skills).toEqual(['a', 'b', 'c'])
  })

  it('ignores an out-of-range index', () => {
    expect(removeSkill(['a'], 5)).toEqual(['a'])
  })
})
