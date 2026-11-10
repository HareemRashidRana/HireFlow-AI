"""add attendance and leave

Revision ID: 99db234e646c
Revises: d34d0c31088c
Create Date: 2026-11-10 23:49:23.385321

"""
import datetime
import uuid
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '99db234e646c'
down_revision: Union[str, Sequence[str], None] = 'd34d0c31088c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema: creates eight new tables and inserts the default working rules and leave types.

    Nothing existing is altered. The two seeded things are plain configuration that HR can change:
    the single work_settings row (Mon-Fri, 09:00-17:00, UTC, 10 minutes grace) and five leave types.
    No leave balances are created: HR grants them explicitly.
    """
    op.create_table('leave_types',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('code', sa.String(length=30), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('is_paid', sa.Boolean(), nullable=False),
    sa.Column('tracks_balance', sa.Boolean(), nullable=False),
    sa.Column('default_days', sa.Numeric(precision=5, scale=1), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('default_days >= 0', name=op.f('ck_leave_types_default_non_negative')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_leave_types')),
    sa.UniqueConstraint('code', name=op.f('uq_leave_types_code'))
    )
    op.create_table('attendance_records',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('work_date', sa.Date(), nullable=False),
    sa.Column('check_in_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('check_out_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('worked_minutes', sa.Integer(), nullable=True),
    sa.Column('is_late', sa.Boolean(), nullable=False),
    sa.Column('left_early', sa.Boolean(), nullable=False),
    sa.Column('source', sa.Enum('self', 'hr', name='attendance_source', native_enum=False, create_constraint=True, length=8), nullable=False),
    sa.Column('corrected', sa.Boolean(), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('check_out_at IS NULL OR check_out_at > check_in_at', name=op.f('ck_attendance_records_checkout_after_checkin')),
    sa.CheckConstraint('worked_minutes IS NULL OR worked_minutes >= 0', name=op.f('ck_attendance_records_worked_non_negative')),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_attendance_records_employee_id_employees'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_attendance_records')),
    sa.UniqueConstraint('employee_id', 'work_date', name='uq_attendance_records_employee_date')
    )
    op.create_index('ix_attendance_records_date', 'attendance_records', ['work_date'], unique=False)
    op.create_index('uq_attendance_records_one_open', 'attendance_records', ['employee_id'], unique=True, postgresql_where=sa.text('check_out_at IS NULL'), sqlite_where=sa.text('check_out_at IS NULL'))
    op.create_table('attendance_corrections',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('record_id', sa.Uuid(), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('reason', sa.String(length=500), nullable=False),
    sa.Column('before', sa.JSON(), nullable=True),
    sa.Column('after', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('length(trim(reason)) > 0', name=op.f('ck_attendance_corrections_reason_required')),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_attendance_corrections_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['record_id'], ['attendance_records.id'], name=op.f('fk_attendance_corrections_record_id_attendance_records'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_attendance_corrections'))
    )
    op.create_index('ix_attendance_corrections_record', 'attendance_corrections', ['record_id', 'created_at'], unique=False)
    op.create_table('holidays',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('created_by_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_holidays_created_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_holidays')),
    sa.UniqueConstraint('day', name=op.f('uq_holidays_day'))
    )
    op.create_table('leave_requests',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('leave_type_id', sa.Uuid(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('days', sa.Numeric(precision=5, scale=1), nullable=False),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'approved', 'rejected', 'withdrawn', 'cancelled', name='leave_status', native_enum=False, create_constraint=True, length=10), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reviewer_id', sa.Uuid(), nullable=True),
    sa.Column('review_reason', sa.String(length=500), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('days > 0', name=op.f('ck_leave_requests_days_positive')),
    sa.CheckConstraint('end_date >= start_date', name=op.f('ck_leave_requests_range_valid')),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_leave_requests_employee_id_employees'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.id'], name=op.f('fk_leave_requests_leave_type_id_leave_types'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['reviewer_id'], ['users.id'], name=op.f('fk_leave_requests_reviewer_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_leave_requests'))
    )
    op.create_index('ix_leave_requests_dates', 'leave_requests', ['start_date', 'end_date'], unique=False)
    op.create_index('ix_leave_requests_employee_start', 'leave_requests', ['employee_id', 'start_date'], unique=False)
    op.create_index('ix_leave_requests_status', 'leave_requests', ['status'], unique=False)
    op.create_table('work_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('work_days', sa.JSON(), nullable=False),
    sa.Column('work_start', sa.Time(), nullable=False),
    sa.Column('work_end', sa.Time(), nullable=False),
    sa.Column('grace_minutes', sa.Integer(), nullable=False),
    sa.Column('max_backdate_days', sa.Integer(), nullable=False),
    sa.Column('updated_by_id', sa.Uuid(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('grace_minutes >= 0 AND grace_minutes <= 240', name=op.f('ck_work_settings_grace_range')),
    sa.CheckConstraint('id = 1', name=op.f('ck_work_settings_single_row')),
    sa.CheckConstraint('max_backdate_days >= 0 AND max_backdate_days <= 366', name=op.f('ck_work_settings_backdate_range')),
    sa.CheckConstraint('work_end > work_start', name=op.f('ck_work_settings_day_ends_after_start')),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_work_settings_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_work_settings'))
    )
    op.create_table('leave_events',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('request_id', sa.Uuid(), nullable=False),
    sa.Column('event_type', sa.Enum('submitted', 'approved', 'rejected', 'withdrawn', 'cancelled', name='leave_event_type', native_enum=False, create_constraint=True, length=10), nullable=False),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('note', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_leave_events_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['request_id'], ['leave_requests.id'], name=op.f('fk_leave_events_request_id_leave_requests'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_leave_events'))
    )
    op.create_index('ix_leave_events_request', 'leave_events', ['request_id', 'created_at'], unique=False)
    op.create_table('leave_ledger',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('employee_id', sa.Uuid(), nullable=False),
    sa.Column('leave_type_id', sa.Uuid(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('entry_type', sa.Enum('allocation', 'deduction', 'reversal', 'adjustment', name='ledger_entry_type', native_enum=False, create_constraint=True), nullable=False),
    sa.Column('days', sa.Numeric(precision=6, scale=1), nullable=False),
    sa.Column('request_id', sa.Uuid(), nullable=True),
    sa.Column('reason', sa.String(length=500), nullable=True),
    sa.Column('actor_id', sa.Uuid(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("(entry_type = 'allocation' AND days >= 0) OR (entry_type = 'deduction' AND days < 0 AND request_id IS NOT NULL) OR (entry_type = 'reversal' AND days > 0 AND request_id IS NOT NULL) OR (entry_type = 'adjustment' AND days <> 0)", name=op.f('ck_leave_ledger_entry_shape')),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_leave_ledger_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], name=op.f('fk_leave_ledger_employee_id_employees'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.id'], name=op.f('fk_leave_ledger_leave_type_id_leave_types'), ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['request_id'], ['leave_requests.id'], name=op.f('fk_leave_ledger_request_id_leave_requests'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_leave_ledger'))
    )
    op.create_index('ix_leave_ledger_balance', 'leave_ledger', ['employee_id', 'leave_type_id', 'year'], unique=False)
    op.create_index('uq_leave_ledger_one_allocation', 'leave_ledger', ['employee_id', 'leave_type_id', 'year'], unique=True, postgresql_where=sa.text("entry_type = 'allocation'"), sqlite_where=sa.text("entry_type = 'allocation'"))
    op.create_index('uq_leave_ledger_one_deduction', 'leave_ledger', ['request_id'], unique=True, postgresql_where=sa.text("entry_type = 'deduction'"), sqlite_where=sa.text("entry_type = 'deduction'"))
    op.create_index('uq_leave_ledger_one_reversal', 'leave_ledger', ['request_id'], unique=True, postgresql_where=sa.text("entry_type = 'reversal'"), sqlite_where=sa.text("entry_type = 'reversal'"))

    settings = sa.table(
        'work_settings',
        sa.column('id', sa.Integer), sa.column('timezone', sa.String), sa.column('work_days', sa.JSON),
        sa.column('work_start', sa.Time), sa.column('work_end', sa.Time), sa.column('grace_minutes', sa.Integer),
        sa.column('max_backdate_days', sa.Integer),
    )
    op.bulk_insert(settings, [{
        'id': 1, 'timezone': 'UTC', 'work_days': [0, 1, 2, 3, 4], 'work_start': datetime.time(9, 0),
        'work_end': datetime.time(17, 0), 'grace_minutes': 10, 'max_backdate_days': 30,
    }])
    types = sa.table(
        'leave_types',
        sa.column('id', sa.Uuid), sa.column('code', sa.String), sa.column('name', sa.String),
        sa.column('is_paid', sa.Boolean), sa.column('tracks_balance', sa.Boolean),
        sa.column('default_days', sa.Numeric), sa.column('is_active', sa.Boolean),
    )
    op.bulk_insert(types, [
        {'id': uuid.uuid4(), 'code': code, 'name': name, 'is_paid': paid, 'tracks_balance': tracks,
         'default_days': days, 'is_active': True}
        for code, name, paid, tracks, days in (
            ('annual', 'Annual leave', True, True, 14),
            ('sick', 'Sick leave', True, True, 10),
            ('casual', 'Casual leave', True, True, 8),
            ('unpaid', 'Unpaid leave', False, False, 0),
            ('other', 'Other leave', True, False, 0),
        )
    ])


def downgrade() -> None:
    """Downgrade schema. Refuses to run once any attendance, leave or holiday record exists, so a
    downgrade can never silently delete people's history. (The default settings and leave types are
    configuration and are removed with their tables.)"""
    if not context.is_offline_mode():
        bind = op.get_bind()
        for table in ('attendance_records', 'attendance_corrections', 'leave_requests', 'leave_events',
                      'leave_ledger', 'holidays'):
            if bind.execute(sa.text(f'SELECT 1 FROM {table} LIMIT 1')).first() is not None:
                raise RuntimeError(
                    f'Refusing to downgrade: {table} contains records. Back up and review them first.'
                )
    op.drop_index('uq_leave_ledger_one_reversal', table_name='leave_ledger', postgresql_where=sa.text("entry_type = 'reversal'"), sqlite_where=sa.text("entry_type = 'reversal'"))
    op.drop_index('uq_leave_ledger_one_deduction', table_name='leave_ledger', postgresql_where=sa.text("entry_type = 'deduction'"), sqlite_where=sa.text("entry_type = 'deduction'"))
    op.drop_index('uq_leave_ledger_one_allocation', table_name='leave_ledger', postgresql_where=sa.text("entry_type = 'allocation'"), sqlite_where=sa.text("entry_type = 'allocation'"))
    op.drop_index('ix_leave_ledger_balance', table_name='leave_ledger')
    op.drop_table('leave_ledger')
    op.drop_index('ix_leave_events_request', table_name='leave_events')
    op.drop_table('leave_events')
    op.drop_table('work_settings')
    op.drop_index('ix_leave_requests_status', table_name='leave_requests')
    op.drop_index('ix_leave_requests_employee_start', table_name='leave_requests')
    op.drop_index('ix_leave_requests_dates', table_name='leave_requests')
    op.drop_table('leave_requests')
    op.drop_table('holidays')
    op.drop_index('ix_attendance_corrections_record', table_name='attendance_corrections')
    op.drop_table('attendance_corrections')
    op.drop_index('uq_attendance_records_one_open', table_name='attendance_records', postgresql_where=sa.text('check_out_at IS NULL'), sqlite_where=sa.text('check_out_at IS NULL'))
    op.drop_index('ix_attendance_records_date', table_name='attendance_records')
    op.drop_table('attendance_records')
    op.drop_table('leave_types')
