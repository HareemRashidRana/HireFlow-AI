"""add job postings

Revision ID: b715414ab1c6
Revises: 535134b74f34
Create Date: 2026-11-10 01:52:14.441502

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b715414ab1c6'
down_revision: Union[str, Sequence[str], None] = '535134b74f34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: adds job_postings only. Existing tables are untouched."""
    op.create_table('job_postings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('title', sa.String(length=150), nullable=False),
    sa.Column('department', sa.String(length=100), nullable=False),
    sa.Column('location', sa.String(length=150), nullable=False),
    sa.Column('employment_type', sa.Enum('full_time', 'part_time', 'contract', 'intern', name='job_employment_type', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('required_skills', sa.JSON(), nullable=False),
    sa.Column('nice_to_have_skills', sa.JSON(), nullable=False),
    sa.Column('min_experience_years', sa.Integer(), nullable=True),
    sa.Column('salary_min', sa.Integer(), nullable=True),
    sa.Column('salary_max', sa.Integer(), nullable=True),
    sa.Column('salary_currency', sa.String(length=3), nullable=True),
    sa.Column('openings', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('draft', 'open', 'on_hold', 'closed', name='job_status', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('hiring_manager_id', sa.Uuid(), nullable=True),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('openings >= 1', name=op.f('ck_job_postings_openings_positive')),
    sa.CheckConstraint('salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max', name=op.f('ck_job_postings_salary_range_ordered')),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_job_postings_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['hiring_manager_id'], ['employees.id'], name=op.f('fk_job_postings_hiring_manager_id_employees'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_job_postings'))
    )
    op.create_index(op.f('ix_job_postings_created_at'), 'job_postings', ['created_at'], unique=False)
    op.create_index(op.f('ix_job_postings_department'), 'job_postings', ['department'], unique=False)
    op.create_index(op.f('ix_job_postings_hiring_manager_id'), 'job_postings', ['hiring_manager_id'], unique=False)
    op.create_index(op.f('ix_job_postings_status'), 'job_postings', ['status'], unique=False)


def downgrade() -> None:
    """Downgrade schema: drops job_postings (and any jobs stored in it)."""
    op.drop_index(op.f('ix_job_postings_status'), table_name='job_postings')
    op.drop_index(op.f('ix_job_postings_hiring_manager_id'), table_name='job_postings')
    op.drop_index(op.f('ix_job_postings_department'), table_name='job_postings')
    op.drop_index(op.f('ix_job_postings_created_at'), table_name='job_postings')
    op.drop_table('job_postings')
