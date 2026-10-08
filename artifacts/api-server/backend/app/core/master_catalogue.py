"""The assignable master catalogue. No role name or business label is a capability."""
MASTERS = ("headquarter", "zone", "mr", "patient", "doctor", "product_category", "location", "courier")
ACTIONS = ("add", "edit", "delete", "import", "export")
MASTER_ACTIONS = frozenset(f"{resource}.{action}" for resource in MASTERS for action in ACTIONS)
