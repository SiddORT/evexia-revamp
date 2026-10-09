"""Verified staff designation identities and retained lifecycle tombstones."""
from alembic import context, op
import sqlalchemy as sa

from app.services.staff_designation_mapping import load_overrides, reconcile

revision = "0028_staff_designation_lifecycle"
down_revision = "0028_directory_soft_delete"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    db.execute(sa.text("LOCK TABLE staff_profiles, designations IN ACCESS EXCLUSIVE MODE"))
    args = context.get_x_argument(as_dictionary=True)
    overrides = load_overrides(args.get("staff_designation_map"))
    resolved, unresolved = reconcile(db, overrides)
    if unresolved:
        # Full read-only preflight is paginated; migration failures remain bounded.
        raise RuntimeError(
            f"Staff designation reconciliation required: {len(unresolved)} unresolved values, "
            f"{sum(row['affected'] for row in unresolved)} profiles. "
            "No schema/data changes applied. Run app.staff_designation_preflight for every "
            "unmatched/ambiguous value and candidate identity, then supply reviewed exact-label "
            "mappings using -x staff_designation_map=/operator/path/map.json. "
            "Missing values require reviewed manual reconciliation; no catalogue rows are created.")
    op.add_column("staff_profiles", sa.Column("designation_id", sa.Uuid(), nullable=True))
    for label, target in resolved.items():
        db.execute(sa.text("UPDATE staff_profiles SET designation_id=:target WHERE designation=:label"),
                   dict(target=target, label=label))
    db.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    if db.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM staff_profiles WHERE designation_id IS NULL)")):
        raise RuntimeError("Incomplete staff mapping; transaction must be rolled back.")
    op.alter_column("staff_profiles", "designation_id", nullable=False)
    op.create_foreign_key("fk_staff_designation", "staff_profiles", "designations",
                          ["designation_id"], ["id"], ondelete="RESTRICT")
    op.add_column("staff_profiles", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("staff_profiles", sa.Column("deleted_by", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_staff_deleted_by", "staff_profiles", "users", ["deleted_by"], ["id"])
    op.drop_column("staff_profiles", "designation")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM staff_profiles)")):
        raise RuntimeError("Populated Staff downgrade is refused: catalogue renames cannot recover original labels or deletion evidence. Use a reviewed forward fix or coordinated backup restore.")
    op.add_column("staff_profiles", sa.Column("designation", sa.String(200), nullable=False))
    op.drop_constraint("fk_staff_deleted_by", "staff_profiles", type_="foreignkey")
    op.drop_column("staff_profiles", "deleted_by")
    op.drop_column("staff_profiles", "deleted_at")
    op.drop_constraint("fk_staff_designation", "staff_profiles", type_="foreignkey")
    op.drop_column("staff_profiles", "designation_id")
