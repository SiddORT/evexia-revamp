"""Reviewed immutable field classification shared by crypto and offline staging."""
FIELDS = {
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
DATE_FIELDS = {("doctor_directory", "dateOfJoining"), ("mr_directory", "dateOfJoining"),
               ("patient_directory", "dateOfBirth")}
NULLABLE_FIELDS = {("doctor_directory", "dateOfJoining")}
INDEX_COLUMNS = {
    "doctor_directory": ("state_index",),
    "mr_directory": ("name_index",),
    "patient_directory": ("duplicate_identity_index",),
}


class DirectoryCryptoError(Exception):
    """Fixed safe failure: no source values, ciphertext, exceptions or secrets."""
    message = "Directory encryption unavailable; no success is confirmed."
    status = 503
    code = "directory_crypto_unavailable"

    def __init__(self):
        super().__init__(self.message)
