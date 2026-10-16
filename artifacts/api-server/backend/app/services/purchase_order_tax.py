"""Ordinary domestic goods only. See docs/purchase-order-backend.md for sources/scope."""
import json
from pathlib import Path
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext

STATES = {s["code"]: s for s in json.loads(Path(__file__).with_name("gst_states.json").read_text())}
COMPONENTS = ("cgst", "sgst", "utgst", "igst")


def supplier_state(gstin):
    if not re.fullmatch(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]", gstin or ""):
        return None
    return STATES.get(gstin[:2])


def tax_basis(gstin, destination):
    from app.services.purchase_orders import POError
    supplier = supplier_state(gstin)
    if not supplier:
        raise POError("Vendor GSTIN has an unsupported registration state. Correct the vendor GSTIN before reviewing.", 422, "po_supplier_state")
    state = STATES.get(destination)
    if not state:
        raise POError("Select a supported Place of supply (State/UT) for this ordinary domestic goods purchase.", 422, "po_place_of_supply")
    treatment = "igst" if supplier["code"] != state["code"] else f"cgst_{state['localTax']}"
    return dict(supplierGstin=gstin, supplierStateCode=supplier["code"], supplierStateName=supplier["name"],
                placeOfSupplyCode=state["code"], placeOfSupplyName=state["name"], treatment=treatment)


def calculate_components(quantity, price, gst, treatment):
    from app.services.purchase_orders import POError, MAX_TOTAL
    with localcontext() as context:
        context.prec = 50
        q, price, gst = Decimal(quantity), Decimal(price), Decimal(gst)
        if not q.is_finite() or q < Decimal(".001") or q > 1000000 or q != q.quantize(Decimal(".001")):
            raise POError("Quantity must be from 0.001 to 1,000,000 with at most three decimals.", 422, "po_quantity")
        if not price.is_finite() or price < 0 or price > Decimal("999999999999.999999") or not gst.is_finite() or not 0 <= gst <= 100:
            raise POError("Catalogue price or GST rate is invalid. Correct the product before reviewing.", 422, "po_catalogue")
        subtotal = int((q * price * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        rates = {k: Decimal(0) for k in COMPONENTS}
        if treatment == "igst":
            rates["igst"] = gst
        else:
            rates["cgst"] = rates[treatment.removeprefix("cgst_")] = gst / 2
        amounts = {k: int((Decimal(subtotal) * rate / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) for k, rate in rates.items()}
        tax = sum(amounts.values())
        if subtotal + tax > MAX_TOTAL:
            raise POError("Line amount exceeds ₹10 crore.", 422, "po_total")
        return dict(subtotal=subtotal, gstAmount=tax, total=subtotal + tax,
                    componentRates={k: format(v, "f") for k, v in rates.items()}, taxComponents=amounts)
