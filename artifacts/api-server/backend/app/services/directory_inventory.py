"""Reviewed immutable field classification shared by crypto and offline staging."""
LEGACY_FIELDS = {
    "doctor_directory": (
        "name", "phone", "alternatePhone", "email", "dialCountry", "dateOfJoining",
        "qualification", "clinicName", "gstNumber", "drugLicenceNumber",
        "addressLine1", "addressLine2", "landmark", "pincode", "city", "state", "country",
    ),
    "mr_directory": (
        "name", "phone", "email", "dateOfJoining", "addressLine1", "addressLine2",
        "landmark", "pincode", "city", "state", "country",
    ),
    "patient_directory": (
        "name", "gender", "phone", "dialCountry", "email", "dateOfBirth",
        "instructionsLanguage", "addressLine1", "addressLine2", "landmark",
        "pincode", "city", "state", "country",
    ),
}
FIELDS = {**LEGACY_FIELDS, "mr_directory": (*LEGACY_FIELDS["mr_directory"], "dialCountry")}
PRIVACY_REVISION = "0036_reference_privacy"
VENDOR_FIELDS = ("registeredAddress", "contactPersonName", "emailId", "phoneNo", "dialCountry")
# FIELDS is the frozen phone-era inventory, also used by predecessor tooling.
REFERENCE_FIELDS = {
    **FIELDS,
    "mr_directory": (*FIELDS["mr_directory"], "reporting_manager_name"),
    "vendors": VENDOR_FIELDS,
}
STAFF_MANAGER_REVISION = "0055_mr_staff_managers"
RUNTIME_FIELDS = {
    **REFERENCE_FIELDS,
    "mr_directory": (*REFERENCE_FIELDS["mr_directory"], "reporting_staff_name"),
}
DATE_FIELDS = {("doctor_directory", "dateOfJoining"), ("mr_directory", "dateOfJoining"),
               ("patient_directory", "dateOfBirth")}
NULLABLE_FIELDS = {("doctor_directory", "dateOfJoining")}
RUNTIME_NULLABLE_FIELDS = NULLABLE_FIELDS | {
    ("mr_directory", "reporting_manager_name"), ("mr_directory", "reporting_staff_name")}
INDEX_COLUMNS = {
    "doctor_directory": ("state_index",),
    "mr_directory": ("name_index",),
    "patient_directory": ("duplicate_identity_index",),
    "vendors": (),
}


class DirectoryCryptoError(Exception):
    """Fixed safe failure: no source values, ciphertext, exceptions or secrets."""
    message = "Directory encryption unavailable; no success is confirmed."
    status = 503
    code = "directory_crypto_unavailable"

    def __init__(self):
        super().__init__(self.message)
