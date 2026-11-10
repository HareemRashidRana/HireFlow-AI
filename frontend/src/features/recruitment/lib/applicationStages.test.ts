import { describe, expect, it } from 'vitest'
import type { ApplicationEvent, ApplicationEventType, ApplicationStage } from '../../../types/application'
import {
  allStages,
  closedStages,
  defaultTarget,
  describeEvent,
  isValidStage,
  pipelineStages,
  stageLabels,
  stageStyles,
} from './applicationStages'

const event = (event_type: ApplicationEventType, from_value: string | null, to_value: string | null): ApplicationEvent => ({
  id: 'e', event_type, from_value, to_value, note: null, actor: null, created_at: '2026-11-03T09:00:00Z',
})

describe('stage lists', () => {
  it('knows every stage the server knows, in pipeline order', () => {
    expect(allStages).toEqual(['applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'])
  })

  it('splits the pipeline from the closed stages without overlap', () => {
    expect(pipelineStages).toEqual(['applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired'])
    expect(closedStages).toEqual(['rejected', 'withdrawn'])
    expect([...pipelineStages, ...closedStages].sort()).toEqual([...allStages].sort())
  })

  it('has a label and a style for every stage', () => {
    for (const s of allStages) {
      expect(stageLabels[s]).toBeTruthy()
      expect(stageStyles[s].badge).toBeTruthy()
    }
  })

  it.each([['applied', true], ['hired', true], ['promoted', false], ['', false], ['APPLIED', false]])(
    'isValidStage(%j) is %s',
    (value, expected) => expect(isValidStage(value)).toBe(expected),
  )
})

describe('describeEvent', () => {
  it.each([
    [event('created', null, 'applied'), 'Application created'],
    [event('stage_changed', 'screening', 'shortlisted'), 'Moved from Screening to Shortlisted'],
    [event('stage_changed', 'interview', 'shortlisted'), 'Moved from Interview to Shortlisted'],
    [event('rejected', 'interview', 'rejected'), 'Rejected (was in Interview)'],
    [event('withdrawn', 'applied', 'withdrawn'), 'Withdrawn (was in Applied)'],
    [event('hired', 'offer', 'hired'), 'Marked as hired'],
    [event('reopened', 'rejected', 'interview'), 'Reopened: back to Interview'],
    [event('notes_updated', null, null), 'Internal notes updated'],
    [event('assigned', null, 'a@x.io'), 'Assigned to a@x.io'],
    [event('assigned', 'a@x.io', 'b@x.io'), 'Reassigned from a@x.io to b@x.io'],
    [event('assigned', 'a@x.io', null), 'Unassigned (was a@x.io)'],
  ])('%#', (e, text) => expect(describeEvent(e)).toBe(text))

  it('does not break on a stage name it has never heard of', () => {
    expect(describeEvent(event('stage_changed', 'applied', 'mystery'))).toBe('Moved from Applied to mystery')
  })
})

describe('defaultTarget (the move dialog pre-selects the forward step)', () => {
  it('prefers the next stage over a step back', () => {
    expect(defaultTarget('screening', ['applied', 'shortlisted', 'rejected', 'withdrawn'])).toBe('shortlisted')
  })

  it('does not pre-select hiring for someone who cannot hire', () => {
    expect(defaultTarget('offer', ['interview', 'rejected', 'withdrawn'])).toBe('interview')
  })

  it('pre-selects hiring when it is on offer', () => {
    expect(defaultTarget('offer', ['interview', 'hired', 'rejected', 'withdrawn'])).toBe('hired')
  })

  it('falls back to the first allowed stage, or null when there is none', () => {
    const closing: ApplicationStage[] = ['rejected', 'withdrawn']
    expect(defaultTarget('applied', closing)).toBe('rejected')
    expect(defaultTarget('hired', [])).toBeNull()
  })
})
