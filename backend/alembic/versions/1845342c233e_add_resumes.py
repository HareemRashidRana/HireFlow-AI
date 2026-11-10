"""add resumes

Revision ID: 1845342c233e
Revises: 2b9e429a0526
Create Date: 2026-11-10 16:07:40.668652

"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1845342c233e'
down_revision: Union[str, Sequence[str], None] = '2b9e429a0526'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

AUDIT_TABLE = 'candidate_audit_events'
AUDIT_CHECK = 'ck_candidate_audit_events_audit_event_type'
OLD_EVENTS = (
    'candidate_viewed', 'candidate_created', 'candidate_updated', 'consent_changed',
    'candidate_exported', 'candidate_anonymized', 'candidate_deleted', 'candidate_purged',
)
RESUME_EVENTS = (
    'resume_uploaded', 'resume_downloaded', 'resume_viewed', 'resume_parsed',
    'resume_parse_retried', 'resume_reviewed', 'resume_activated', 'resume_updated',
    'resume_deleted',
)


def _in_list(values):
    return ', '.join("'" + v + "'" for v in values)


def upgrade() -> None:
    """Upgrade schema: adds the resumes table and WIDENS one CHECK constraint on the audit table.

    The only change to an existing table is replacing the allowed-values CHECK on
    candidate_audit_events.event_type with one that also allows the new resume event types. No row
    is read, changed or deleted. (Alembic's autogenerate cannot see CHECK changes, so this is
    written by hand.)
    """
    op.create_table('resumes',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('candidate_id', sa.Uuid(), nullable=False),
    sa.Column('application_id', sa.Uuid(), nullable=True),
    sa.Column('version_number', sa.Integer(), nullable=False),
    sa.Column('original_filename', sa.String(length=255), nullable=False),
    sa.Column('storage_key', sa.String(length=32), nullable=True),
    sa.Column('mime_type', sa.String(length=100), nullable=False),
    sa.Column('extension', sa.String(length=8), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=True),
    sa.Column('status', sa.Enum('pending', 'processing', 'parsed', 'no_text', 'failed', 'removed', name='resume_status', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('parse_error_code', sa.String(length=40), nullable=True),
    sa.Column('text_chars', sa.Integer(), nullable=True),
    sa.Column('parsed_data', sa.JSON(), nullable=True),
    sa.Column('parsed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reviewed_data', sa.JSON(), nullable=True),
    sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reviewed_by_id', sa.Uuid(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('uploaded_by_id', sa.Uuid(), nullable=True),
    sa.Column('file_removed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("NOT is_active OR status <> 'removed'", name=op.f('ck_resumes_active_not_removed')),
    sa.CheckConstraint("extension IN ('pdf', 'docx')", name=op.f('ck_resumes_extension_allowed')),
    sa.CheckConstraint('size_bytes > 0', name=op.f('ck_resumes_size_positive')),
    sa.CheckConstraint('version_number >= 1', name=op.f('ck_resumes_version_positive')),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], name=op.f('fk_resumes_application_id_applications'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id'], name=op.f('fk_resumes_candidate_id_candidates'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['reviewed_by_id'], ['users.id'], name=op.f('fk_resumes_reviewed_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['uploaded_by_id'], ['users.id'], name=op.f('fk_resumes_uploaded_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_resumes')),
    sa.UniqueConstraint('candidate_id', 'sha256', name='uq_resumes_candidate_id_sha256'),
    sa.UniqueConstraint('candidate_id', 'version_number', name='uq_resumes_candidate_id_version'),
    sa.UniqueConstraint('storage_key', name=op.f('uq_resumes_storage_key'))
    )
    op.create_index(op.f('ix_resumes_application_id'), 'resumes', ['application_id'], unique=False)
    op.create_index(op.f('ix_resumes_candidate_id'), 'resumes', ['candidate_id'], unique=False)
    op.create_index(op.f('ix_resumes_created_at'), 'resumes', ['created_at'], unique=False)
    op.create_index(op.f('ix_resumes_sha256'), 'resumes', ['sha256'], unique=False)
    op.create_index(op.f('ix_resumes_status'), 'resumes', ['status'], unique=False)
    op.create_index('uq_resumes_one_active_per_candidate', 'resumes', ['candidate_id'], unique=True, postgresql_where=sa.text('is_active'), sqlite_where=sa.text('is_active'))

    # Allow the new audit event types (existing rows all satisfy the wider rule).
    op.drop_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, type_='check')
    op.create_check_constraint(
        op.f(AUDIT_CHECK), AUDIT_TABLE, 'event_type IN (' + _in_list(OLD_EVENTS + RESUME_EVENTS) + ')'
    )


def downgrade() -> None:
    """Downgrade schema: drops resumes and restores the narrower audit CHECK.

    Refuses to run if resume audit events exist: restoring the narrower rule would be impossible,
    and deleting audit history silently is not acceptable. Export or remove those events first.
    Resume FILES in storage are not touched by a migration (clean them with the cleanup script).
    """
    if not context.is_offline_mode():  # the guard needs a live connection (a --sql preview has none)
        existing = op.get_bind().execute(
            sa.text('SELECT count(*) FROM ' + AUDIT_TABLE + ' WHERE event_type IN (' + _in_list(RESUME_EVENTS) + ')')
        ).scalar()
        if existing:
            raise RuntimeError(
                f'Cannot downgrade: {existing} resume audit event(s) exist. '
                'Export or remove them deliberately first.'
            )
    op.drop_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, type_='check')
    op.create_check_constraint(op.f(AUDIT_CHECK), AUDIT_TABLE, 'event_type IN (' + _in_list(OLD_EVENTS) + ')')

    op.drop_index('uq_resumes_one_active_per_candidate', table_name='resumes', postgresql_where=sa.text('is_active'), sqlite_where=sa.text('is_active'))
    op.drop_index(op.f('ix_resumes_status'), table_name='resumes')
    op.drop_index(op.f('ix_resumes_sha256'), table_name='resumes')
    op.drop_index(op.f('ix_resumes_created_at'), table_name='resumes')
    op.drop_index(op.f('ix_resumes_candidate_id'), table_name='resumes')
    op.drop_index(op.f('ix_resumes_application_id'), table_name='resumes')
    op.drop_table('resumes')
