"""add applications

Revision ID: 5773edf6f24d
Revises: fe06a57b2010
Create Date: 2026-11-10 03:37:28.265538

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5773edf6f24d'
down_revision: Union[str, Sequence[str], None] = 'fe06a57b2010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: adds applications and application_events only.

    Existing tables are only referenced by foreign keys (candidates, job_postings, users); none of
    them is altered. Both links to candidates / job_postings are RESTRICT, so application history
    can never be deleted along with a candidate or a job.
    """
    op.create_table('applications',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('candidate_id', sa.Uuid(), nullable=False),
    sa.Column('job_id', sa.Uuid(), nullable=False),
    sa.Column('stage', sa.Enum('applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn', name='application_stage', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('source', sa.Enum('referral', 'linkedin', 'job_board', 'agency', 'direct', 'other', name='application_source', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('assigned_recruiter_id', sa.Uuid(), nullable=True),
    sa.Column('internal_notes', sa.Text(), nullable=True),
    sa.Column('applied_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('stage_changed_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['assigned_recruiter_id'], ['users.id'], name=op.f('fk_applications_assigned_recruiter_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], name=op.f('fk_applications_candidate_id_candidates'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_applications_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['job_id'], ['job_postings.id'], name=op.f('fk_applications_job_id_job_postings'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_applications')),
    sa.UniqueConstraint('candidate_id', 'job_id', name='uq_applications_candidate_id_job_id')
    )
    op.create_index(op.f('ix_applications_applied_at'), 'applications', ['applied_at'], unique=False)
    op.create_index(op.f('ix_applications_assigned_recruiter_id'), 'applications', ['assigned_recruiter_id'], unique=False)
    op.create_index(op.f('ix_applications_candidate_id'), 'applications', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_applications_job_id'), 'applications', ['job_id'], unique=False)
    op.create_index('ix_applications_job_stage', 'applications', ['job_id', 'stage'], unique=False)
    op.create_index(op.f('ix_applications_stage'), 'applications', ['stage'], unique=False)
    op.create_table('application_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('application_id', sa.Uuid(), nullable=False),
    sa.Column('event_type', sa.Enum('created', 'stage_changed', 'assigned', 'rejected', 'withdrawn', 'hired', 'reopened', 'notes_updated', name='application_event_type', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('from_value', sa.String(length=255), nullable=True),
    sa.Column('to_value', sa.String(length=255), nullable=True),
    sa.Column('note', sa.String(length=500), nullable=True),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_application_events_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], name=op.f('fk_application_events_application_id_applications'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_application_events'))
    )
    op.create_index('ix_application_events_application_created', 'application_events', ['application_id', 'created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema: drops both tables (and every application and history row in them)."""
    op.drop_index('ix_application_events_application_created', table_name='application_events')
    op.drop_table('application_events')
    op.drop_index(op.f('ix_applications_stage'), table_name='applications')
    op.drop_index('ix_applications_job_stage', table_name='applications')
    op.drop_index(op.f('ix_applications_job_id'), table_name='applications')
    op.drop_index(op.f('ix_applications_candidate_id'), table_name='applications')
    op.drop_index(op.f('ix_applications_assigned_recruiter_id'), table_name='applications')
    op.drop_index(op.f('ix_applications_applied_at'), table_name='applications')
    op.drop_table('applications')
