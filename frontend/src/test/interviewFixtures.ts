import type {
  Feedback,
  FeedbackOverview,
  Interview,
  InterviewList,
  InterviewStats,
  RatingScale,
  StaffRef,
} from '../types/interview'

export const rec: StaffRef = { id: 'u-rec', email: 'recruiter@example.com', role: 'recruiter' }
export const hr: StaffRef = { id: 'u-hr', email: 'hr@example.com', role: 'hr_manager' }

export function makeInterview(overrides: Partial<Interview> = {}): Interview {
  return {
    id: 'int-1',
    application: {
      id: 'app-1',
      stage: 'interview',
      candidate: { id: 'cand-1', first_name: 'Sana', last_name: 'Iqbal' },
      job: { id: 'job-1', title: 'Backend Engineer' },
    },
    title: 'Technical interview',
    interview_type: 'technical',
    round_number: 1,
    mode: 'online',
    status: 'scheduled',
    starts_at: '2026-11-20T05:00:00Z',
    ends_at: '2026-11-20T06:00:00Z',
    timezone: 'Asia/Karachi',
    starts_local: '2026-11-20T10:00',
    ends_local: '2026-11-20T11:00',
    utc_offset: '+05:00',
    duration_minutes: 60,
    location: null,
    meeting_url: 'https://meet.example.com/room/abc',
    interviewers: [{ ...rec, feedback_status: 'none' }],
    rescheduled_from_id: null,
    rescheduled_to_id: null,
    cancellation_reason: null,
    cancelled_at: null,
    completed_at: null,
    created_by: hr,
    updated_by: hr,
    created_at: '2026-11-10T09:00:00Z',
    updated_at: '2026-11-10T09:00:00Z',
    scrubbed: false,
    allowed_actions: ['view_history', 'update', 'cancel', 'reschedule', 'manage_interviewers', 'confirm'],
    my_feedback_status: null,
    ...overrides,
  }
}

export const list = (items: Interview[], over: Partial<InterviewList> = {}): InterviewList => ({
  items, total: items.length, page: 1, page_size: 10, ...over,
})

export const stats: InterviewStats = {
  total: 7,
  by_status: { scheduled: 3, confirmed: 1, completed: 1, cancelled: 1, rescheduled: 1 },
  upcoming: 4,
  next_7_days: 2,
  feedback_pending: 2,
  feedback_submitted: 1,
  upcoming_by_day: [{ date: '2026-11-20', count: 2 }],
}

export const scale: RatingScale = {
  scale: [
    { value: 1, label: 'Well below expectations', description: 'Did not demonstrate it.' },
    { value: 2, label: 'Below expectations', description: 'Some, with gaps.' },
    { value: 3, label: 'Meets expectations', description: 'Demonstrated it.' },
    { value: 4, label: 'Above expectations', description: 'More than needed.' },
    { value: 5, label: 'Well above expectations', description: 'Far more than needed.' },
  ],
  areas: [
    { key: 'overall_rating', label: 'Overall', required_to_submit: true },
    { key: 'technical_rating', label: 'Technical', required_to_submit: false },
    { key: 'communication_rating', label: 'Communication', required_to_submit: false },
    { key: 'problem_solving_rating', label: 'Problem solving', required_to_submit: false },
  ],
}

export function makeFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: 'fb-1', interview_id: 'int-1', interviewer: rec, status: 'submitted', overall_rating: 4, technical_rating: 4,
    communication_rating: 5, problem_solving_rating: null, overall_feedback: 'Solid conversation.', technical_notes: null,
    role_notes: null, strengths: 'Communication', concerns: null, private_notes: null, version: 1,
    submitted_at: '2026-11-20T07:00:00Z', updated_at: '2026-11-20T07:00:00Z', is_mine: false, scrubbed: false, ...overrides,
  }
}

export const overview = (items: Feedback[], over: Partial<FeedbackOverview> = {}): FeedbackOverview => ({
  interview_id: 'int-1', items, can_view_all: true, submitted_count: items.filter((f) => f.status === 'submitted').length,
  pending_interviewers: [], ...over,
})
