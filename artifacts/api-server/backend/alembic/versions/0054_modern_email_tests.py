"""Separate MR invitations, preserve authored source, and admit test evidence."""
import uuid
from alembic import op
from alembic.script import ScriptDirectory
import sqlalchemy as sa

revision = "0054_modern_email_tests"
down_revision = "0053_email_invitations"
branch_labels = depends_on = None


def _html(event):
    # Frozen migration presentation. Do not import mutable runtime defaults.
    invitation = event in ("account_invitation", "mr_invitation")
    mr = event == "mr_invitation"
    title = ("Welcome to the MR portal" if mr else "Welcome to the Admin workspace") if invitation else "Reset your password"
    intro = ('You are invited to the EVEXIA {{portal_name}}. Your User ID is <strong>{{login_id}}</strong>.'
             if invitation else "A password reset was requested for your EVEXIA account.")
    action = "Set password" if invitation else "Reset password"
    warning = ("If unexpected, ignore this email. Existing credentials remain unchanged until acceptance."
               if invitation else "If you did not request this, ignore this email. Your password has not changed.")
    return (
        '<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f5fa;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#28263a"><tr><td align="center">'
        '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #ddd7e5;border-radius:16px;border-collapse:separate">'
        '<tr><td style="padding:28px;background-color:#f0eaf5;text-align:center">'
        '<img src="/images/evexia-logo.png" alt="EVEXIA Life Sciences" width="154" height="80">'
        '<p style="font-size:12px;color:#6c5d7f;letter-spacing:1px;margin:16px 0">EVEXIA LIFE SCIENCES</p></td></tr>'
        '<tr><td style="padding:28px;line-height:1.7">'
        f'<h1 style="font-size:26px;line-height:1.3;color:#187368;margin:0 0 24px">{title}</h1>'
        '<p>Hello {{recipient_name}},</p>'
        f'<p>{intro}</p>'
        '<p style="margin:28px 0;text-align:center"><a href="{{reset_url}}" style="display:inline-block;background-color:#187368;color:#ffffff;padding:16px 28px;border-radius:8px;font-weight:bold;text-decoration:none">'
        + action + '</a></p>'
        '<p>This one-use link expires in {{expiry_minutes}} minutes.</p>'
        '<p style="font-size:13px;color:#5d586b">If the button does not work, copy and paste this URL into your browser:</p>'
        '<p style="font-size:13px;overflow-wrap:anywhere"><a href="{{reset_url}}" style="color:#187368;text-decoration:underline">{{reset_url}}</a></p>'
        f'<p style="font-size:13px;color:#5d586b">{warning}</p>'
        '<hr style="border:1px solid #ddd7e5"><p style="font-size:12px;color:#6c5d7f">{{company_name}}</p>'
        '</td></tr></table></td></tr></table>'
    )


SEEDS = {
    "password_recovery": dict(
        id="e7e80000-0000-4000-8000-000000000001", name="Forgot password",
        description="Password recovery for eligible staff and MR accounts.",
        subject="Reset your EVEXIA password", html=_html("password_recovery"),
        text="Hello {{recipient_name}},\n\nA password reset was requested for your EVEXIA account.\n\n{{reset_url}}\n\nThis link expires in {{expiry_minutes}} minutes and can be used once. If you did not request this, ignore this email. Your password has not changed.\n\n— {{company_name}}"),
    "account_invitation": dict(
        id="e7e80000-0000-4000-8000-000000000002", name="Invite staff member",
        description="Set-password invitation for eligible staff in the Admin workspace.",
        subject="Your EVEXIA Admin workspace invitation", html=_html("account_invitation"),
        text="Hello {{recipient_name}},\n\nYou are invited to the EVEXIA {{portal_name}} as a staff member.\nYour User ID is {{login_id}}.\n\nSet password: {{reset_url}}\nThis one-use link expires in {{expiry_minutes}} minutes.\nIf unexpected, ignore this email. Existing credentials remain unchanged until acceptance.\n\n{{company_name}}"),
    "mr_invitation": dict(
        id="e7e80000-0000-4000-8000-000000000003", name="Invite MR member",
        description="Set-password invitation for eligible members of the MR portal.",
        subject="Your EVEXIA MR portal invitation", html=_html("mr_invitation"),
        text="Hello {{recipient_name}},\n\nYou are invited to the EVEXIA {{portal_name}} as an MR member.\nYour User ID is {{login_id}}.\n\nSet password: {{reset_url}}\nThis one-use link expires in {{expiry_minutes}} minutes.\nIf unexpected, ignore this email. Existing credentials remain unchanged until acceptance.\n\n{{company_name}}"),
}


def upgrade():
    op.drop_constraint("ck_email_template_assignment", "email_templates")
    op.drop_constraint("ck_email_template_provenance", "email_templates")
    op.create_check_constraint("ck_email_template_assignment", "email_templates",
        "(id='e7e80000-0000-4000-8000-000000000001' AND event_key IS NOT NULL AND event_key='password_recovery') OR "
        "(id='e7e80000-0000-4000-8000-000000000002' AND event_key IS NOT NULL AND event_key='account_invitation') OR "
        "(id='e7e80000-0000-4000-8000-000000000003' AND event_key IS NOT NULL AND event_key='mr_invitation') OR "
        "(id NOT IN ('e7e80000-0000-4000-8000-000000000001','e7e80000-0000-4000-8000-000000000002',"
        "'e7e80000-0000-4000-8000-000000000003') AND event_key IS NULL)")
    op.create_check_constraint("ck_email_template_provenance", "email_templates",
        "(provenance='migration_seed' AND id IN ('e7e80000-0000-4000-8000-000000000001',"
        "'e7e80000-0000-4000-8000-000000000002','e7e80000-0000-4000-8000-000000000003') AND created_by IS NULL) OR "
        "(provenance='administrator' AND created_by IS NOT NULL)")
    op.drop_constraint("ck_email_attempt_purpose", "email_attempts")
    op.create_check_constraint("ck_email_attempt_purpose", "email_attempts",
                               "purpose IN ('password_recovery','account_invitation','template_test')")
    # Attempts retain selected identity/version even when an unassigned template
    # is later deleted. Required template deletion remains guarded independently.
    op.drop_constraint("email_attempts_template_id_fkey", "email_attempts", type_="foreignkey")
    connection = op.get_bind()
    connection.execute(sa.text("SELECT pg_advisory_xact_lock(5310043)"))
    script = ScriptDirectory.from_config(op.get_context().config)
    # Exact untouched legacy source only. Never rewrite an administrator's
    # source, name, identity, version or attribution. Existing guards stay active.
    for old_revision, event in (("0043_email_templates", "password_recovery"),
                                ("0053_email_invitations", "account_invitation")):
        old = script.get_revision(old_revision).module.SEED
        new = SEEDS[event]
        connection.execute(sa.text("""
            UPDATE email_templates SET description=:description, subject=:subject, html=:html, text=:text
            WHERE id=:id AND version=1 AND provenance='migration_seed'
              AND created_by IS NULL AND updated_by IS NULL AND created_at=updated_at
              AND description=:old_description AND subject=:old_subject AND html=:old_html AND text=:old_text
        """), {**{k: new[k] for k in ("id", "description", "subject", "html", "text")},
               **{"old_" + k: old[k] for k in ("description", "subject", "html", "text")}})
    seed = SEEDS["mr_invitation"]
    name, suffix = seed["name"], 0
    while connection.scalar(sa.text("SELECT 1 FROM email_templates WHERE lower(name)=lower(:name)"), {"name": name}):
        suffix += 1
        name = f"Invite MR member (required {suffix})"
    table = sa.table("email_templates", *(sa.column(k, sa.Uuid() if k == "id" else sa.Text()) for k in seed),
                     sa.column("version", sa.Integer()), sa.column("event_key", sa.Text()), sa.column("provenance", sa.Text()))
    # Capacity advances from 101 to 102 in the application, retaining a full
    # existing library without deleting or renaming any administrator row.
    op.bulk_insert(table, [{**seed, "id": uuid.UUID(seed["id"]), "name": name, "version": 1,
                            "event_key": "mr_invitation", "provenance": "migration_seed"}])
    # The inherited trigger protects ANY assigned event, including this new row,
    # against delete, truncate, reassignment and identity/provenance changes.


def downgrade():
    raise RuntimeError("Required email content and test evidence require coordinated recovery; downgrade refused.")
