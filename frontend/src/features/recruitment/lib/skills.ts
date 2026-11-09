export const MAX_SKILLS = 30
export const MAX_SKILL_LENGTH = 50

export interface AddResult {
  skills: string[]
  /** Set when something could not be added; the skills that were valid are still included. */
  error: string | null
}

/**
 * Adds skills typed or pasted as free text ("python, sql\nreact") to an existing list.
 * Mirrors the server: blanks dropped, inner spaces collapsed, case-insensitive de-duplication
 * (first spelling wins), at most 30 skills of at most 50 characters each.
 */
export function addSkills(current: string[], raw: string): AddResult {
  const skills = [...current]
  const seen = new Set(skills.map((s) => s.toLowerCase()))
  let error: string | null = null

  for (const part of raw.split(/[,\n;]/)) {
    const skill = part.split(/\s+/).filter(Boolean).join(' ')
    if (!skill || seen.has(skill.toLowerCase())) continue
    if (skill.length > MAX_SKILL_LENGTH) {
      error = `Each skill must be at most ${MAX_SKILL_LENGTH} characters.`
      continue
    }
    if (skills.length >= MAX_SKILLS) {
      error = `You can add at most ${MAX_SKILLS} skills.`
      break
    }
    skills.push(skill)
    seen.add(skill.toLowerCase())
  }
  return { skills, error }
}

export const removeSkill = (skills: string[], index: number): string[] =>
  skills.filter((_, i) => i !== index)
