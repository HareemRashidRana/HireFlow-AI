"""add candidates

Revision ID: fe06a57b2010
Revises: b715414ab1c6
Create Date: 2026-11-10 02:35:58.613826

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fe06a57b2010'
down_revision: Union[str, Sequence[str], None] = 'b715414ab1c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: adds candidates only. Employees and every other table are untouched."""
    op.create_table('candidates',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('first_name', sa.String(length=100), nullable=False),
    sa.Column('last_name', sa.String(length=100), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('phone', sa.String(length=20), nullable=True),
    sa.Column('location', sa.String(length=150), nullable=True),
    sa.Column('current_title', sa.String(length=150), nullable=True),
    sa.Column('current_company', sa.String(length=150), nullable=True),
    sa.Column('source', sa.Enum('referral', 'linkedin', 'job_board', 'agency', 'direct', 'other', name='candidate_source', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('consent_basis', sa.Enum('consent', 'legitimate_interest', 'pre_contract_steps', 'other', name='consent_basis', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('consent_basis_note', sa.String(length=200), nullable=True),
    sa.Column('consent_date', sa.Date(), nullable=False),
    sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('retain_until', sa.Date(), nullable=False),
    sa.Column('anonymized_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("consent_basis <> 'other' OR (consent_basis_note IS NOT NULL AND TRIM(consent_basis_note) <> '')", name=op.f('ck_candidates_basis_note_when_other')),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_candidates_created_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_candidates'))
    )
    op.create_index(op.f('ix_candidates_created_at'), 'candidates', ['created_at'], unique=False)
    op.create_index(op.f('ix_candidates_email'), 'candidates', ['email'], unique=True)
    op.create_index(op.f('ix_candidates_retain_until'), 'candidates', ['retain_until'], unique=False)


def downgrade() -> None:
    """Downgrade schema: drops candidates (and every candidate stored in it)."""
    op.drop_index(op.f('ix_candidates_retain_until'), table_name='candidates')
    op.drop_index(op.f('ix_candidates_email'), table_name='candidates')
    op.drop_index(op.f('ix_candidates_created_at'), table_name='candidates')
    op.drop_table('candidates')
