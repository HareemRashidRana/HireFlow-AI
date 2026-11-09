"""add users refresh tokens and login attempts

Revision ID: 535134b74f34
Revises: 67d7e79d6075
Create Date: 2026-11-10 01:00:23.746277

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '535134b74f34'
down_revision: Union[str, Sequence[str], None] = '67d7e79d6075'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: authentication tables only. The existing `employees` table is untouched."""
    op.create_table('login_attempts',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('identifier_hash', sa.String(length=64), nullable=False),
    sa.Column('ip_address', sa.String(length=45), nullable=False),
    sa.Column('succeeded', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_login_attempts'))
    )
    op.create_index(op.f('ix_login_attempts_created_at'), 'login_attempts', ['created_at'], unique=False)
    op.create_index('ix_login_attempts_identifier_created', 'login_attempts', ['identifier_hash', 'created_at'], unique=False)
    op.create_index('ix_login_attempts_ip_created', 'login_attempts', ['ip_address', 'created_at'], unique=False)
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.Enum('admin', 'hr_manager', 'recruiter', 'employee', name='user_role', native_enum=False, create_constraint=True, length=20), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('must_change_password', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=True),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_users_employee_id_employees'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('employee_id', name=op.f('uq_users_employee_id'))
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_role'), 'users', ['role'], unique=False)
    op.create_table('refresh_tokens',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('family_id', sa.Uuid(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('session_expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_refresh_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_refresh_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_refresh_tokens_token_hash'))
    )
    op.create_index(op.f('ix_refresh_tokens_family_id'), 'refresh_tokens', ['family_id'], unique=False)
    op.create_index(op.f('ix_refresh_tokens_user_id'), 'refresh_tokens', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema: drops the authentication tables (and any users/sessions in them)."""
    op.drop_index(op.f('ix_refresh_tokens_user_id'), table_name='refresh_tokens')
    op.drop_index(op.f('ix_refresh_tokens_family_id'), table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.drop_index(op.f('ix_users_role'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_index('ix_login_attempts_ip_created', table_name='login_attempts')
    op.drop_index('ix_login_attempts_identifier_created', table_name='login_attempts')
    op.drop_index(op.f('ix_login_attempts_created_at'), table_name='login_attempts')
    op.drop_table('login_attempts')
