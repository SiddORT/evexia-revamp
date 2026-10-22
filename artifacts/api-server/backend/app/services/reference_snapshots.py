"""Server-owned assignment labels; recapture only on explicit ID changes."""
from sqlalchemy import select
from app.services.directory_inventory import DirectoryCryptoError


def referenced(db, model, record_id):
    # Lock references until the assignment transaction commits. Never fall back
    # to a live name during projection when a saved label is unavailable.
    # The ID and its saved label are an atomic pair. Do not flush a partially
    # reassigned pair while obtaining the newly selected reference.
    with db.no_autoflush:
        row = db.scalar(select(model).where(model.id == record_id)
                        .execution_options(populate_existing=True).with_for_update(read=True))
    if row is None:
        raise DirectoryCryptoError()
    return row


def capture_mr(db, row, previous=None):
    from app.db.headquarter_models import Headquarter
    from app.db.zone_models import Zone
    from app.db.mr_models import MRDirectory
    for field, saved, model in (("hq", "hq_name", Headquarter), ("zoneId", "zone_name", Zone)):
        if previous is None or previous[field] != getattr(row, field):
            setattr(row, saved, referenced(db, model, getattr(row, field)).name)
    if previous is None or previous["reportingManagerId"] != row.reportingManagerId:
        row.reporting_manager_name = (
            referenced(db, MRDirectory, row.reportingManagerId).name if row.reportingManagerId else None)
    if previous is None or previous.get("reportingStaffId") != row.reportingStaffId:
        from app.db.staff_models import StaffProfile
        from app.services.staff_crypto import StaffCrypto
        from app.core.config import get_settings
        staff = referenced(db, StaffProfile, row.reportingStaffId) if row.reportingStaffId else None
        row.reporting_staff_name = (StaffCrypto(get_settings()).decrypt(staff.id, "name", staff.name_ciphertext)
                                    if staff else None)
