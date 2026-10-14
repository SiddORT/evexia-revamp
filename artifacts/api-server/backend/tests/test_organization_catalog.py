"""Strict CHECK-format compatibility; no database or environment credentials."""
import pytest

from app.services.organization_retirement import _baseline_role_check


ORIGINAL = (
    "(role)::text = ANY ((ARRAY['owner'::character varying, "
    "'admin'::character varying, 'viewer'::character varying])::text[])"
)
RESTORED = (
    "(role)::text = ANY (ARRAY[('owner'::character varying)::text, "
    "('admin'::character varying)::text, ('viewer'::character varying)::text])"
)


@pytest.mark.parametrize("expression", [ORIGINAL, RESTORED])
def test_accepts_exact_original_and_dump_restored_cast_forms(expression):
    assert _baseline_role_check([{"sqltext": expression}])


@pytest.mark.parametrize("expression", [ORIGINAL, RESTORED])
@pytest.mark.parametrize("change", [
    lambda s: s.replace("'viewer'", "'intruder'"),
    lambda s: s.replace("'admin'", "'Admin'"),
    lambda s: s.replace("'owner'", "'own(er)'"),
    lambda s: s.replace("'owner'", "'ow''ner'"),
    lambda s: s.replace("'owner'", "'own\"er'"),
    lambda s: s.replace("'viewer'", "'viewer', 'intruder'"),
    lambda s: s.replace("= ANY", "<> ALL"),
    lambda s: s + " OR true",
    lambda s: s + " AND false",
    lambda s: s.replace("role", "other_role"),
    lambda s: s.replace("character varying", "public.custom_role"),
    lambda s: s.replace("::text", "::public.custom_text"),
    lambda s: s.replace("= ANY", "= public.unreviewed_function"),
])
def test_rejects_changed_roles_operators_types_and_conditions(expression, change):
    assert not _baseline_role_check([{"sqltext": change(expression)}])


@pytest.mark.parametrize("checks", [
    [],
    [{"sqltext": ORIGINAL}, {"sqltext": RESTORED}],
    [{"sqltext": ORIGINAL}, {"sqltext": "true"}],
    [{"sqltext": None}],
    [{}],
    [{"sqltext": 123}],
    [{"sqltext": ORIGINAL + "'"}],
    [{"sqltext": RESTORED + '"'}],
    [{"sqltext": ORIGINAL.replace("'owner'", "'owner")}],
])
def test_rejects_missing_extra_or_malformed_checks(checks):
    assert not _baseline_role_check(checks)
