"""Required verified actor attribution and retained custom role deletion."""
from alembic import context, op
import sqlalchemy as sa

from app.services.role_attribution import coverage, load_mapping, reconcile

revision = "0029_role_lifecycle"
down_revision = "0028_staff_designation_lifecycle"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    # Freeze all evidence and assignments, and prevent actor deletion until FKs
    # are installed. Coordinated rollout must stop old application nodes too.
    db.execute(sa.text("LOCK TABLE custom_roles, staff_profiles, audit_events, users IN ACCESS EXCLUSIVE MODE"))
    mapping = load_mapping(context.get_x_argument(as_dictionary=True).get("role_attribution_map"))
    report = reconcile(db, mapping)
    if coverage(report)["unresolved_fields"]:
        unresolved = [
            f"{r['role_id']} {field}: {e['reason']}"
            for r in report for field, e in r["fields"].items() if e["source"] == "unresolved"]
        raise RuntimeError(
            "Role attribution required; no changes applied. " + "; ".join(unresolved[:20]) +
            f". Total unresolved fields: {len(unresolved)}. Run app.role_attribution_preflight "
            "for the full paginated report; supply reviewed field-specific existing-user mappings "
            "with -x role_attribution_map=/operator/path/map.json.")
    for field in ("created_by", "updated_by", "deleted_by"):
        op.add_column("custom_roles", sa.Column(field, sa.Uuid(), nullable=True))
    op.add_column("custom_roles", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    for role in report:
        db.execute(sa.text("UPDATE custom_roles SET created_by=:creator, updated_by=:updater WHERE id=:id"),
                   dict(id=role["role_id"], creator=role["fields"]["created_by"]["user_id"],
                        updater=role["fields"]["updated_by"]["user_id"]))
    db.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    for field in ("created_by", "updated_by", "deleted_by"):
        op.create_foreign_key(f"fk_custom_roles_{field}", "custom_roles", "users", [field], ["id"], ondelete="RESTRICT")
    for field in ("created_by", "updated_by"):
        op.alter_column("custom_roles", field, nullable=False)


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM custom_roles)")):
        raise RuntimeError("Populated role downgrade is refused: attribution/deletion evidence would be lost and unavailable grants revived. Use reviewed forward repair or a coordinated backup restore.")
    for field in ("created_by", "updated_by", "deleted_by"):
        op.drop_constraint(f"fk_custom_roles_{field}", "custom_roles", type_="foreignkey")
        op.drop_column("custom_roles", field)
    op.drop_column("custom_roles", "deleted_at")
