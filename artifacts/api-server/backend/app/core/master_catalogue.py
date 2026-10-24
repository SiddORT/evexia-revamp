"""Explicit supported capabilities. Role names and designations grant nothing.

Keep historical keys stable. New keys are never inferred for persisted roles.
Assembly, stock adjustments and identity administration are not assignable.
"""
CRUD_TRANSFER = ("view", "add", "edit", "delete", "import", "export")
MASTER_RESOURCES = {
    "headquarter": CRUD_TRANSFER,
    "zone": CRUD_TRANSFER,
    "mr": CRUD_TRANSFER,
    "patient": CRUD_TRANSFER,
    "doctor": CRUD_TRANSFER,
    "product_category": CRUD_TRANSFER,
    "location": CRUD_TRANSFER,
    "courier": CRUD_TRANSFER,
    "language": CRUD_TRANSFER,
    "designation": CRUD_TRANSFER,
    "allergen": CRUD_TRANSFER,
    "product": CRUD_TRANSFER,
    "vendor": CRUD_TRANSFER,
    "sales_target": CRUD_TRANSFER,
    "opening_balance": CRUD_TRANSFER,
    "opening_stock": ("view", "add", "import", "export"),
}
PROCUREMENT_ACTIONS = (
    "view", "add", "edit", "delete", "export", "print",
    "history", "activity", "analytics",
)
RESOURCE_ACTIONS = {
    **MASTER_RESOURCES,
    "purchase_order": PROCUREMENT_ACTIONS,
    "purchase_received": PROCUREMENT_ACTIONS,
    "stock_movement": ("view", "create", "activity", "analytics"),
    "stock_status": ("view", "export", "history"),
    "immunotherapy": ("view", "add", "edit", "import", "export", "upload_attachment", "read_attachment"),
    "spt": ("view", "add", "edit", "import", "export"),
    "kits": ("view", "add", "import", "export", "upload_attachment", "read_attachment"),
    "lupin": ("view", "add", "import", "export", "upload_attachment", "read_attachment"),
    "staff": ("view", "add", "edit", "delete", "status"),
    "staff_access": ("view",),
    "role": ("view", "add", "edit", "delete"),
    "permissions": ("view",),
}
MASTERS = tuple(MASTER_RESOURCES)
ACTIONS = CRUD_TRANSFER
MASTER_ACTIONS = frozenset(
    f"{resource}.{action}" for resource, actions in MASTER_RESOURCES.items() for action in actions
)
ASSIGNABLE_ACTIONS = frozenset(
    f"{resource}.{action}" for resource, actions in RESOURCE_ACTIONS.items() for action in actions
)
PROTECTED_ACTIONS = frozenset({"permissions.change", "staff_access.assign_role", "staff_access.login"})
