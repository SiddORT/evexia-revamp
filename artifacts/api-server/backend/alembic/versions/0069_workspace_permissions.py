"""Expand the explicit role constraint without granting or rewriting any role."""
from alembic import op
import sqlalchemy as sa

revision = "0069_workspace_permissions"
down_revision = "0068_category_description"
branch_labels = None
depends_on = None

# Frozen migration contract: never import the evolving application catalogue.
CRUD = ("view", "add", "edit", "delete", "import", "export")
RESOURCES = {
    "headquarter": CRUD, "zone": CRUD, "mr": CRUD, "patient": CRUD, "doctor": CRUD,
    "product_category": CRUD, "location": CRUD, "courier": CRUD, "language": CRUD,
    "designation": CRUD, "allergen": CRUD, "product": CRUD, "vendor": CRUD,
    "sales_target": CRUD, "opening_balance": CRUD,
    "opening_stock": ("view", "add", "import", "export"),
    "purchase_order": ("view", "add", "edit", "delete", "export", "print", "history", "activity", "analytics"),
    "purchase_received": ("view", "add", "edit", "delete", "export", "print", "history", "activity", "analytics"),
    "stock_movement": ("view", "create", "activity", "analytics"),
    "stock_status": ("view", "export", "history"),
    "immunotherapy": ("view", "add", "edit", "import", "export", "upload_attachment", "read_attachment"),
    "spt": ("view", "add", "edit", "import", "export"),
    "kits": ("view", "add", "import", "export", "upload_attachment", "read_attachment"),
    "lupin": ("view", "add", "import", "export", "upload_attachment", "read_attachment"),
    "staff": ("view", "add", "edit", "delete", "status"),
    "staff_access": ("view",), "role": ("view", "add", "edit", "delete"), "permissions": ("view",),
}
NEW = sorted(f"{resource}.{action}" for resource, actions in RESOURCES.items() for action in actions)
OLD = sorted(f"{resource}.{action}"
             for resource in ("headquarter", "zone", "mr", "patient", "doctor", "product_category", "location", "courier")
             for action in ("add", "edit", "delete", "import", "export"))


def predicate(keys):
    return ("permissions <@ ARRAY[" + ",".join(f"'{key}'" for key in keys)
            + f"]::varchar[] AND cardinality(permissions) <= {len(keys)}"
            + " AND array_position(permissions, NULL) IS NULL")


def upgrade():
    op.drop_constraint("ck_custom_roles_permissions", "custom_roles", type_="check")
    op.create_check_constraint("ck_custom_roles_permissions", "custom_roles", predicate(NEW))


def downgrade():
    if op.get_bind().scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM custom_roles WHERE NOT ({predicate(OLD)}))")):
        raise RuntimeError("Explicitly remove expanded grants before downgrading; roles will not be rewritten automatically")
    op.drop_constraint("ck_custom_roles_permissions", "custom_roles", type_="check")
    op.create_check_constraint("ck_custom_roles_permissions", "custom_roles", predicate(OLD))
