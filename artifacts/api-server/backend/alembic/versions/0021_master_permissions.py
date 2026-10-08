"""Extend the allowlist without adding grants or changing staff access."""
from alembic import op

revision = "0021_master_permissions"
down_revision = "0020_patient_directory"
branch_labels = depends_on = None


def upgrade():
    # Freeze the migration catalogue; do not import evolving application policy.
    resources = ("headquarter", "zone", "mr", "patient", "doctor",
                 "product_category", "location", "courier")
    keys = ",".join(f"'{resource}.{action}'" for resource in resources
                    for action in ("add", "edit", "delete", "import", "export"))
    op.drop_constraint("ck_custom_roles_permissions", "custom_roles", type_="check")
    op.create_check_constraint("ck_custom_roles_permissions", "custom_roles",
        f"permissions <@ ARRAY[{keys}]::varchar[] AND cardinality(permissions) <= 40 "
        "AND array_position(permissions, NULL) IS NULL")


def downgrade():
    op.execute("""DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM custom_roles WHERE NOT
        permissions <@ ARRAY['zone.add','zone.edit','zone.delete','zone.import','zone.export']::varchar[])
      THEN RAISE EXCEPTION 'Explicitly remove non-Zone grants before downgrade'; END IF;
    END $$""")
    op.drop_constraint("ck_custom_roles_permissions", "custom_roles", type_="check")
    op.create_check_constraint("ck_custom_roles_permissions", "custom_roles",
        "permissions <@ ARRAY['zone.add','zone.edit','zone.delete','zone.import','zone.export']::varchar[] "
        "AND cardinality(permissions) <= 5 AND array_position(permissions, NULL) IS NULL")
