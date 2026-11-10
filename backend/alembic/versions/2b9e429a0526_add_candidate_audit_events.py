"""add candidate audit events

Revision ID: 2b9e429a0526
Revises: 5773edf6f24d
Create Date: 2026-11-10 14:15:32.542742

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2b9e429a0526'
down_revision: Union[str, Sequence[str], None] = '5773edf6f24d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: adds candidate_audit_events only. No existing table is altered.

    candidate_id is deliberately NOT a foreign key: the audit trail must outlive a deleted candidate.
    """
    op.create_table('candidate_audit_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('event_type', sa.Enum('candidate_viewed', 'candidate_created', 'candidate_updated', 'consent_changed', 'candidate_exported', 'candidate_anonymized', 'candidate_deleted', 'candidate_purged', name='audit_event_type', native_enum=False, create_constraint=True, length=24), nullable=False),
    sa.Column('candidate_id', sa.Uuid(), nullable=True),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('metadata', sa.JSON(), nullable=False),
    sa.Column('request_id', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_candidate_audit_events_actor_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_candidate_audit_events'))
    )
    op.create_index(op.f('ix_candidate_audit_events_actor_id'), 'candidate_audit_events', ['actor_id'], unique=False)
    op.create_index('ix_candidate_audit_events_candidate_created', 'candidate_audit_events', ['candidate_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_candidate_audit_events_created_at'), 'candidate_audit_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_candidate_audit_events_event_type'), 'candidate_audit_events', ['event_type'], unique=False)


def downgrade() -> None:
    """Downgrade schema: drops candidate_audit_events (and the audit history stored in it)."""
    op.drop_index(op.f('ix_candidate_audit_events_event_type'), table_name='candidate_audit_events')
    op.drop_index(op.f('ix_candidate_audit_events_created_at'), table_name='candidate_audit_events')
    op.drop_index('ix_candidate_audit_events_candidate_created', table_name='candidate_audit_events')
    op.drop_index(op.f('ix_candidate_audit_events_actor_id'), table_name='candidate_audit_events')
    op.drop_table('candidate_audit_events')
