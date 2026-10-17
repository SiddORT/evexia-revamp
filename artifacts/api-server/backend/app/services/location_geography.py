"""Structured identity only: never interpret a free-text address."""
import re
from app.services.purchase_order_tax import STATES


def state_key(value):
    return re.sub(r"[^a-z0-9]", "", value.casefold().replace("&", "and"))


ALIASES = {
    "orissa": "21", "uttaranchal": "05", "pondicherry": "34",
    "nctofdelhi": "07", "andamanandnicobarislands": "35",
    "dadraandnagarhavelianddamananddiu": "26",
    "dadraandnagarhaveli": "26", "damananddiu": "26",
}


def indian_state(value):
    key = state_key(value)
    code = ALIASES.get(key)
    return STATES.get(code) if code else next(
        (item for item in STATES.values() if key in (item["code"], state_key(item["name"]))), None)


def geography(row):
    state = indian_state(row.state) if row.countryCode == "IN" else None
    return dict(pincode=row.pincode, countryCode=row.countryCode, state=row.state, city=row.city,
                stateCode=state["code"] if state else None)
