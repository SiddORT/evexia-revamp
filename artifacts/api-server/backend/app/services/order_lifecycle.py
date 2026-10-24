"""Read compatibility only. Never manufacture historical decision evidence."""


def status(value):
    return "In process" if value == "Approved" else value


def counts(values):
    result = dict(values)
    if "Approved" in result:
        result["In process"] = result.get("In process", 0) + result.pop("Approved")
    return result


def filter_status(column, value):
    return column.in_(["Approved", "In process"]) if value in {"Approved", "In process"} else column == value


def read_result(value):
    """Normalize old encrypted retry responses without changing their evidence."""
    if isinstance(value, list):
        return [read_result(child) for child in value]
    if isinstance(value, dict):
        result = {key: read_result(child) for key, child in value.items()}
        if {"id", "number", "version", "status"}.issubset(result):
            result["status"] = status(result["status"])
            if result["status"] in {"Confirmed", "Saved"} and result.get("approval"):
                result["status"] = "In process"
                result["mrEditable"] = False
                result.pop("decisionEligibility", None)
        return result
    return value
