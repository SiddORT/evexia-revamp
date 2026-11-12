"""Language activation state; preserve records and append-only historical rows."""
from alembic import op
import sqlalchemy as sa

revision = "0093_language_status"
# Keep the unrelated low-stock successors staged beyond the declared target.
down_revision = "0089_it_material_pricing"
branch_labels = depends_on = None


def upgrade():
    op.add_column("languages", sa.Column("status", sa.String(8), nullable=False, server_default="active"))
    op.create_check_constraint("ck_languages_status", "languages", "status IN ('active', 'inactive')")
    # Nullable additions retain the exact meaning and bytes of historical events.
    op.add_column("language_changes", sa.Column("before_status", sa.String(8)))
    op.add_column("language_changes", sa.Column("after_status", sa.String(8)))
    op.drop_constraint("ck_language_changes_action", "language_changes", type_="check")
    op.create_check_constraint("ck_language_changes_action", "language_changes",
                               "action IN ('create', 'edit', 'delete', 'status')")
    op.drop_constraint("ck_language_changes_before", "language_changes", type_="check")
    op.create_check_constraint("ck_language_changes_before", "language_changes",
        "(action = 'create' AND before_name IS NULL AND version = 1) OR "
        "(action IN ('edit', 'delete', 'status') AND before_name IS NOT NULL AND version > 1)")
    op.create_check_constraint("ck_language_changes_status", "language_changes",
        "(action = 'status' AND before_status IS NOT NULL AND after_status IS NOT NULL "
        "AND before_status IN ('active', 'inactive') AND after_status IN ('active', 'inactive') "
        "AND before_status <> after_status AND before_name = after_name) OR "
        "(action <> 'status' AND before_status IS NULL AND after_status IS NULL)")


def downgrade():
    # No silent loss of activation evidence or inactive state on application rollback.
    raise RuntimeError("Language status and retained status history require a forward migration.")
