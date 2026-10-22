"""Allow saved Role names as Staff metadata, without granting workspace access."""
from alembic import op
import sqlalchemy as sa

revision = "0056_staff_business_roles"
down_revision = "0055_mr_staff_managers"
branch_labels = depends_on = None


def upgrade():
    op.drop_constraint("ck_staff_role", "staff_profiles", type_="check")
    op.alter_column("staff_profiles", "role", existing_type=sa.String(20),
                    type_=sa.String(100), existing_nullable=False)
    op.create_check_constraint("ck_staff_role", "staff_profiles",
                               "char_length(role) BETWEEN 1 AND 100 AND char_length(btrim(role)) > 0")


def downgrade():
    # Restoring the fixed enum could discard valid custom metadata snapshots.
    raise RuntimeError("Custom Staff role snapshots require coordinated recovery; downgrade refused.")
