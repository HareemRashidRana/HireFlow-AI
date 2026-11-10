"""add screening assessments and reviews

Revision ID: e06ccfa51fe7
Revises: 1845342c233e
Create Date: 2026-11-10 19:36:36.021010

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e06ccfa51fe7'
down_revision: Union[str, Sequence[str], None] = '1845342c233e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AUDIT_TABLE = 'candidate_audit_events'
AUDIT_CHECK = 'ck_candidate_audit_events_audit_event_type'
PREVIOUS_EVENTS = (
    'candidate_viewed', 'candidate_created', 'candidate_updated', 'consent_changed',
    'candidate_exported', 'candidate_anonymized', 'candidate_deleted', 'candidate_purged',
    'resume_uploaded', 'resume_downloaded', 'resume_viewed', 'resume_parsed',
    'resume_parse_retried', 'resume_reviewed', 'resume_activated', 'resume_updated',
    'resume_deleted',
)
SCREENING_EVENTS = (
    'screening_created', 'screening_viewed', 'screening_reviewed', 'screening_scrubbed',
)


def _in_list(values):
    return ', '.join("'" + v + "'" for v in values)


def upgrade() -> None:
    """Upgrade schema: adds screening_assessments and screening_reviews and WIDENS one CHECK
    constraint on the audit table so it also allows the four screening event types.

    The only change to an existing table is replacing the allowed-values CHECK on
    candidate_audit_events.event_type. No row is read, changed or deleted. (Alembic's autogenerate
    cannot see CHECK changes, so that part is written by hand.)
    """
    op.create_table('screening_assessments',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('application_id', sa.Uuid(), nullable=False),
    sa.Column('assessment_number', sa.Integer(), nullable=False),
    sa.Column('resume_id', sa.Uuid(), nullable=True),
    sa.Column('resume_version_number', sa.Integer(), nullable=True),
    sa.Column('resume_reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('input_fingerprint', sa.String(length=64), nullable=True),
    sa.Column('scoring_version', sa.String(length=32), nullable=False),
    sa.Column('alias_table_version', sa.String(length=32), nullable=False),
    sa.Column('weights', sa.JSON(), nullable=False),
    sa.Column('job_snapshot', sa.JSON(), nullable=False),
    sa.Column('status', sa.Enum('scored', 'unscored', name='assessment_status', native_enum=False, create_constraint=True, length=10), nullable=False),
    sa.Column('total_score', sa.Numeric(precision=4, scale=1), nullable=True),
    sa.Column('assessed_weight', sa.Integer(), nullable=False),
    sa.Column('criteria', sa.JSON(), nullable=False),
    sa.Column('experience', sa.JSON(), nullable=True),
    sa.Column('warnings', sa.JSON(), nullable=False),
    sa.Column('explanation', sa.Text(), nullable=False),
    sa.Column('limitations', sa.JSON(), nullable=False),
    sa.Column('requested_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('scrubbed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('scrub_reason', sa.Enum('anonymized', 'resume_deleted', name='scrub_reason', native_enum=False, create_constraint=True, length=16), nullable=True),
    sa.CheckConstraint("(status = 'scored' AND total_score IS NOT NULL AND assessed_weight > 0) OR (status = 'unscored' AND total_score IS NULL AND assessed_weight = 0)", name=op.f('ck_screening_assessments_status_matches_score')),
    sa.CheckConstraint('assessed_weight IN (0, 20, 80, 100)', name=op.f('ck_screening_assessments_assessed_weight_valid')),
    sa.CheckConstraint('assessment_number >= 1', name=op.f('ck_screening_assessments_number_positive')),
    sa.CheckConstraint('input_fingerprint IS NULL OR length(input_fingerprint) = 64', name=op.f('ck_screening_assessments_fingerprint_length')),
    sa.CheckConstraint('total_score IS NULL OR (total_score >= 0 AND total_score <= 100)', name=op.f('ck_screening_assessments_score_range')),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], name=op.f('fk_screening_assessments_application_id_applications'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['requested_by_id'], ['users.id'], name=op.f('fk_screening_assessments_requested_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['resume_id'], ['resumes.id'], name=op.f('fk_screening_assessments_resume_id_resumes'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_screening_assessments')),
    sa.UniqueConstraint('application_id', 'assessment_number', name='uq_screening_assessments_number'),
    sa.UniqueConstraint('application_id', 'input_fingerprint', 'resume_id', 'resume_reviewed_at', name='uq_screening_assessments_identity')
    )
    op.create_index('ix_screening_assessments_application_created', 'screening_assessments', ['application_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_screening_assessments_application_id'), 'screening_assessments', ['application_id'], unique=False)
    op.create_index(op.f('ix_screening_assessments_created_at'), 'screening_assessments', ['created_at'], unique=False)
    op.create_index(op.f('ix_screening_assessments_resume_id'), 'screening_assessments', ['resume_id'], unique=False)
    op.create_table('screening_reviews',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('assessment_id', sa.Uuid(), nullable=False),
    sa.Column('reviewer_id', sa.Uuid(), nullable=True),
    sa.Column('judgement', sa.Enum('agree', 'disagree', 'unsure', name='review_judgement', native_enum=False, create_constraint=True, length=10), nullable=False),
    sa.Column('adjustments', sa.JSON(), nullable=True),
    sa.Column('adjustment_reason', sa.Enum('evidenced_elsewhere', 'equivalent_skill', 'resume_incomplete', 'other', name='adjustment_reason', native_enum=False, create_constraint=True, length=20), nullable=True),
    sa.Column('note', sa.String(length=1000), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('scrubbed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint('adjustment_reason IS NULL OR adjustments IS NOT NULL OR scrubbed_at IS NOT NULL', name=op.f('ck_screening_reviews_reason_needs_adjustments')),
    sa.CheckConstraint('note IS NULL OR length(note) <= 1000', name=op.f('ck_screening_reviews_note_length')),
    sa.ForeignKeyConstraint(['assessment_id'], ['screening_assessments.id'], name=op.f('fk_screening_reviews_assessment_id_screening_assessments'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['reviewer_id'], ['users.id'], name=op.f('fk_screening_reviews_reviewer_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_screening_reviews'))
    )
    op.create_index('ix_screening_reviews_assessment_created', 'screening_reviews', ['assessment_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_screening_reviews_assessment_id'), 'screening_reviews', ['assessment_id'], unique=False)

    # Allow the new audit event types (existing rows all satisfy the wider rule).
    op.drop_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, type_='check')
    op.create_check_constraint(
        op.f(AUDIT_CHECK), AUDIT_TABLE, 'event_type IN (' + _in_list(PREVIOUS_EVENTS + SCREENING_EVENTS) + ')'
    )


def downgrade() -> None:
    """Downgrade schema: drops the screening tables and restores the narrower audit CHECK.

    Refuses to run if screening audit events exist: restoring the narrower rule would be impossible,
    and deleting audit history silently is not acceptable. It also refuses while any assessment or
    review rows exist, so a downgrade can never silently discard Requirements Coverage history.
    """
    if not context.is_offline_mode():  # the guards need a live connection (a --sql preview has none)
        bind = op.get_bind()
        events = bind.execute(
            sa.text('SELECT count(*) FROM ' + AUDIT_TABLE + ' WHERE event_type IN (' + _in_list(SCREENING_EVENTS) + ')')
        ).scalar()
        rows = bind.execute(sa.text('SELECT count(*) FROM screening_assessments')).scalar()
        if events or rows:
            raise RuntimeError(
                f'Cannot downgrade: {rows} screening assessment(s) and {events} screening audit event(s) '
                'exist. Export or remove them deliberately first.'
            )
    op.drop_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, type_='check')
    op.create_check_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, 'event_type IN (' + _in_list(PREVIOUS_EVENTS) + ')')

    op.drop_index(op.f('ix_screening_reviews_assessment_id'), table_name='screening_reviews')
    op.drop_index('ix_screening_reviews_assessment_created', table_name='screening_reviews')
    op.drop_table('screening_reviews')
    op.drop_index(op.f('ix_screening_assessments_resume_id'), table_name='screening_assessments')
    op.drop_index(op.f('ix_screening_assessments_created_at'), table_name='screening_assessments')
    op.drop_index(op.f('ix_screening_assessments_application_id'), table_name='screening_assessments')
    op.drop_index('ix_screening_assessments_application_created', table_name='screening_assessments')
    op.drop_table('screening_assessments')
