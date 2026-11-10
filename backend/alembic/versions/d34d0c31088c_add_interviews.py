"""add interviews

Revision ID: d34d0c31088c
Revises: e06ccfa51fe7
Create Date: 2026-11-10 21:33:51.831929

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd34d0c31088c'
down_revision: Union[str, Sequence[str], None] = 'e06ccfa51fe7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AUDIT_TABLE = 'candidate_audit_events'
AUDIT_CHECK = 'ck_candidate_audit_events_audit_event_type'
PREVIOUS_EVENTS = (
    'candidate_viewed', 'candidate_created', 'candidate_updated', 'consent_changed',
    'candidate_exported', 'candidate_anonymized', 'candidate_deleted', 'candidate_purged',
    'resume_uploaded', 'resume_downloaded', 'resume_viewed', 'resume_parsed',
    'resume_parse_retried', 'resume_reviewed', 'resume_activated', 'resume_updated',
    'resume_deleted', 'screening_created', 'screening_viewed', 'screening_reviewed',
    'screening_scrubbed',
)
INTERVIEW_EVENTS = (
    'interview_created', 'interview_updated', 'interview_confirmed', 'interview_completed',
    'interview_cancelled', 'interview_rescheduled', 'interviewers_changed',
    'feedback_draft_saved', 'feedback_submitted', 'feedback_edited', 'interview_scrubbed',
)

def _in_list(values):
    return ', '.join("'" + v + "'" for v in values)


def upgrade() -> None:
    """Upgrade schema: adds the interview tables and WIDENS one CHECK constraint on the audit table
    so it also allows the eleven interview event types.

    The only change to an existing table is replacing the allowed-values CHECK on
    candidate_audit_events.event_type. No row is read, changed or deleted. (Alembic's autogenerate
    cannot see CHECK changes, so that part is written by hand.)
    """
    op.create_table('interviews',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('application_id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=150), nullable=False),
    sa.Column('interview_type', sa.Enum('phone_screen', 'technical', 'behavioral', 'hr_round', 'panel', 'final', 'other', name='interview_type', native_enum=False, create_constraint=True, length=16), nullable=False),
    sa.Column('round_number', sa.Integer(), nullable=False),
    sa.Column('mode', sa.Enum('online', 'in_person', 'phone', name='interview_mode', native_enum=False, create_constraint=True, length=10), nullable=False),
    sa.Column('status', sa.Enum('scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled', name='interview_status', native_enum=False, create_constraint=True, length=12), nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('location', sa.String(length=255), nullable=True),
    sa.Column('meeting_url', sa.String(length=500), nullable=True),
    sa.Column('rescheduled_from_id', sa.Uuid(), nullable=True),
    sa.Column('cancellation_reason', sa.String(length=500), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('scrubbed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('updated_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("meeting_url IS NULL OR substr(meeting_url, 1, 8) = 'https://'", name=op.f('ck_interviews_meeting_url_https')),
    sa.CheckConstraint("status <> 'cancelled' OR cancellation_reason IS NOT NULL", name=op.f('ck_interviews_cancel_has_reason')),
    sa.CheckConstraint('ends_at > starts_at', name=op.f('ck_interviews_ends_after_start')),
    sa.CheckConstraint('round_number >= 1', name=op.f('ck_interviews_round_positive')),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], name=op.f('fk_interviews_application_id_applications'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_interviews_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['rescheduled_from_id'], ['interviews.id'], name=op.f('fk_interviews_rescheduled_from_id_interviews'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_interviews_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_interviews')),
    sa.UniqueConstraint('rescheduled_from_id', name='uq_interviews_rescheduled_from')
    )
    op.create_index(op.f('ix_interviews_application_id'), 'interviews', ['application_id'], unique=False)
    op.create_index('ix_interviews_application_starts', 'interviews', ['application_id', 'starts_at'], unique=False)
    op.create_index('ix_interviews_starts_at', 'interviews', ['starts_at'], unique=False)
    op.create_index('ix_interviews_status_starts', 'interviews', ['status', 'starts_at'], unique=False)
    op.create_table('interview_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('interview_id', sa.Uuid(), nullable=False),
    sa.Column('event_type', sa.Enum('created', 'updated', 'confirmed', 'completed', 'cancelled', 'rescheduled', 'interviewer_added', 'interviewer_removed', name='interview_event_type', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('details', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_interview_events_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], name=op.f('fk_interview_events_interview_id_interviews'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_interview_events'))
    )
    op.create_index('ix_interview_events_interview_created', 'interview_events', ['interview_id', 'created_at'], unique=False)
    op.create_table('interview_feedback',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('interview_id', sa.Uuid(), nullable=False),
    sa.Column('interviewer_id', sa.Uuid(), nullable=True),
    sa.Column('status', sa.Enum('draft', 'submitted', name='feedback_status', native_enum=False, create_constraint=True, length=10), nullable=False),
    sa.Column('overall_rating', sa.Integer(), nullable=True),
    sa.Column('technical_rating', sa.Integer(), nullable=True),
    sa.Column('communication_rating', sa.Integer(), nullable=True),
    sa.Column('problem_solving_rating', sa.Integer(), nullable=True),
    sa.Column('overall_feedback', sa.Text(), nullable=True),
    sa.Column('technical_notes', sa.Text(), nullable=True),
    sa.Column('role_notes', sa.Text(), nullable=True),
    sa.Column('strengths', sa.Text(), nullable=True),
    sa.Column('concerns', sa.Text(), nullable=True),
    sa.Column('private_notes', sa.Text(), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('scrubbed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status <> 'submitted' OR (submitted_at IS NOT NULL AND overall_rating IS NOT NULL)", name=op.f('ck_interview_feedback_submitted_is_complete')),
    sa.CheckConstraint('(overall_rating IS NULL OR overall_rating BETWEEN 1 AND 5) AND (technical_rating IS NULL OR technical_rating BETWEEN 1 AND 5) AND (communication_rating IS NULL OR communication_rating BETWEEN 1 AND 5) AND (problem_solving_rating IS NULL OR problem_solving_rating BETWEEN 1 AND 5)', name=op.f('ck_interview_feedback_ratings_in_range')),
    sa.CheckConstraint('version >= 1', name=op.f('ck_interview_feedback_version_positive')),
    sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], name=op.f('fk_interview_feedback_interview_id_interviews'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['interviewer_id'], ['users.id'], name=op.f('fk_interview_feedback_interviewer_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_interview_feedback')),
    sa.UniqueConstraint('interview_id', 'interviewer_id', name='uq_interview_feedback_pair')
    )
    op.create_index('ix_interview_feedback_interviewer', 'interview_feedback', ['interviewer_id'], unique=False)
    op.create_table('interview_interviewers',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('interview_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('added_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['added_by_id'], ['users.id'], name=op.f('fk_interview_interviewers_added_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], name=op.f('fk_interview_interviewers_interview_id_interviews'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_interview_interviewers_user_id_users'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_interview_interviewers')),
    sa.UniqueConstraint('interview_id', 'user_id', name='uq_interview_interviewers_pair')
    )
    op.create_index('ix_interview_interviewers_user', 'interview_interviewers', ['user_id'], unique=False)
    op.create_table('interview_feedback_revisions',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('feedback_id', sa.Uuid(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('snapshot', sa.JSON(), nullable=False),
    sa.Column('edit_reason', sa.String(length=300), nullable=True),
    sa.Column('edited_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['edited_by_id'], ['users.id'], name=op.f('fk_interview_feedback_revisions_edited_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['feedback_id'], ['interview_feedback.id'], name=op.f('fk_interview_feedback_revisions_feedback_id_interview_feedback'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_interview_feedback_revisions')),
    sa.UniqueConstraint('feedback_id', 'version', name='uq_feedback_revisions_version')
    )

    # Allow the new audit event types (existing rows all satisfy the wider rule).
    op.drop_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, type_='check')
    op.create_check_constraint(
        op.f(AUDIT_CHECK), AUDIT_TABLE, 'event_type IN (' + _in_list(PREVIOUS_EVENTS + INTERVIEW_EVENTS) + ')'
    )


def downgrade() -> None:
    """Downgrade schema: drops the interview tables and restores the narrower audit CHECK.

    Refuses to run while any interview or interview audit event exists: restoring the narrower rule
    would be impossible, and silently discarding interview history is not acceptable. Export or
    remove them deliberately first.
    """
    if not context.is_offline_mode():  # the guards need a live connection (a --sql preview has none)
        bind = op.get_bind()
        events = bind.execute(
            sa.text('SELECT count(*) FROM ' + AUDIT_TABLE + ' WHERE event_type IN (' + _in_list(INTERVIEW_EVENTS) + ')')
        ).scalar()
        rows = bind.execute(sa.text('SELECT count(*) FROM interviews')).scalar()
        if events or rows:
            raise RuntimeError(
                f'Cannot downgrade: {rows} interview(s) and {events} interview audit event(s) exist. '
                'Export or remove them deliberately first.'
            )
    op.drop_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, type_='check')
    op.create_check_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, 'event_type IN (' + _in_list(PREVIOUS_EVENTS) + ')')

    op.drop_table('interview_feedback_revisions')
    op.drop_index('ix_interview_interviewers_user', table_name='interview_interviewers')
    op.drop_table('interview_interviewers')
    op.drop_index('ix_interview_feedback_interviewer', table_name='interview_feedback')
    op.drop_table('interview_feedback')
    op.drop_index('ix_interview_events_interview_created', table_name='interview_events')
    op.drop_table('interview_events')
    op.drop_index('ix_interviews_status_starts', table_name='interviews')
    op.drop_index('ix_interviews_starts_at', table_name='interviews')
    op.drop_index('ix_interviews_application_starts', table_name='interviews')
    op.drop_index(op.f('ix_interviews_application_id'), table_name='interviews')
    op.drop_table('interviews')
