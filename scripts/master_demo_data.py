"""Fictional, deterministic business inputs; no credentials or stock fixtures."""

PREFIX = "Master Demo"
ADDRESS = dict(addressLine1="1 Fictional Demo Lane", addressLine2="Sample data only",
               landmark="Fictional Sample Centre", pincode="560001",
               city="Demo City", state="Demo State", country="India")


def catalogue():
    for name in ("North", "Central", "South"):
        yield "zones", dict(name=f"{PREFIX} {name} Zone", status="active")
    for index, name in enumerate(("Cold Room", "Main Store", "Sample Shelf")):
        yield "locations", dict(name=f"{PREFIX} {name}",
                               address=f"{index + 1} Fictional Demo Lane, Demo City; sample data only",
                               status="active")
    for name, price in (("Pollen", "750"), ("Mites", "1250.50"), ("Blends", "1850.25")):
        yield "categories", dict(name=f"{PREFIX} {name}", description="Fictional demonstration category only",
                                unit_price=price, status="active")
    for index, name in enumerate(("North", "Central", "South"), 1):
        yield "headquarters", dict(name=f"{PREFIX} {name} HQ", state_code=f"MDHQ{index}", status="active")
    yield "designations", dict(name=f"{PREFIX} Representative", shortName="MDREP", status="active")


def products(categories, locations):
    rows = (
        ("Grass Alpha", 0, 0, "1000 PNU/ml", "750", "5", False),
        ("Tree Beta", 0, 1, "5000 PNU/ml", "925.50", "12", False),
        ("Weed Gamma", 0, 2, "10000 PNU/ml", "1125.125", "18", False),
        ("Mite Delta", 1, 0, "1000 AU/ml", "1250.50", "5", False),
        ("Mite Epsilon", 1, 1, "10000 AU/ml", "1499.99", "12", False),
        ("Pollen Blend", 2, 0, "5000 PNU/ml", "1850.25", "18", True),
        ("Mixed Blend", 2, 1, "1000 AU/ml", "2100.123456", "5", True),
        ("Zero-price Sample", 2, 2, "100 AU/ml", "0", "0", True),
    )
    for name, cat, loc, concentration, price, gst, mix in rows:
        yield dict(name=f"{PREFIX} {name}", category_id=categories[cat].id,
                   storage_location_id=locations[loc].id, concentration=concentration,
                   selling_price=price, gst=gst, threshold_limit="10", mix=mix, status="active")


def representatives(zones, headquarters, designation):
    for index, name in enumerate(("Alpha", "Beta", "Gamma"), 1):
        yield dict(**ADDRESS, name=f"{PREFIX} MR {name}", userId=f"master.demo.mr{index}",
                   employeeCode=f"MASTER-DEMO-MR-{index:02}", contactRequirement="optional",
                   phone="", email=f"master-demo-mr{index}@example.com", dialCountry="IN",
                   hq=headquarters[index - 1].id, zoneId=zones[index - 1].id,
                   designation_id=designation.id, dateOfJoining="2025-01-01",
                   paymentLimit="0", doctorDaysLimit=0, status="active")


def physicians(mrs):
    for index, name in enumerate(("Alpha", "Beta", "Gamma"), 1):
        yield dict(**ADDRESS, name=f"{PREFIX} Doctor {name}",
                   registrationNumber=f"MASTER-DEMO-DOC-{index:02}", qualification="Demo MBBS",
                   clinicName=f"{PREFIX} Clinic {name}", mrId=mrs[index - 1].id,
                   contactRequirement="optional", phone="", email=f"master-demo-doc{index}@example.com",
                   status="active")


def patients(doctors):
    # UK regulator-reserved drama numbers, not potentially real Indian mobiles.
    for index in range(1, 7):
        yield f"PAT-MASTER-DEMO-{index:02}", dict(
            **ADDRESS, name=f"{PREFIX} Patient {index:02}", gender="prefer not to say",
            dialCountry="GB", phone=f"7700900{index:03}", email=f"master-demo-patient{index}@example.com",
            dateOfBirth=f"199{index}-01-15", doctorId=doctors[(index - 1) % 3].id,
            instructionsLanguage="English", status="active")
