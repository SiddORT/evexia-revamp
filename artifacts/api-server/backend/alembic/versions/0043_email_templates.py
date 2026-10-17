"""Dedicated email source and protected recovery assignment. Operator approval required."""
from alembic import op
import sqlalchemy as sa

revision = "0043_email_templates"
down_revision = "0042_rate_hundredths"
branch_labels = depends_on = None

# Frozen migration content, not a runtime fallback or imported mutable service seed.
SEED = dict(
    id="e7e80000-0000-4000-8000-000000000001",
    name="Forgot password",
    description="Password recovery for eligible staff and MR accounts.",
    subject="Reset your EVEXIA password",
    html="""<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef4f5;padding:24px 12px;font-family:Arial,sans-serif;color:#203b48"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border:1px solid #dce7e9;border-radius:16px"><tr><td style="padding:28px;text-align:center">
<img src="/images/evexia-logo.png" alt="EVEXIA Life Sciences" width="154" height="80">
<h1 style="font-size:26px;color:#126b70;margin:16px 0">Reset your password</h1>
<p style="text-align:left">Hello {{recipient_name}},</p>
<p style="text-align:left;line-height:1.6">A password reset was requested for your EVEXIA account.</p>
<p style="margin:24px 0"><a href="{{reset_url}}" style="display:inline-block;background-color:#126b70;color:#ffffff;padding:14px 24px;border-radius:8px;font-weight:bold;text-decoration:none">Reset password</a></p>
<p style="text-align:left">This link expires in {{expiry_minutes}} minutes and can be used once.</p>
<p style="text-align:left;font-size:12px;color:#526b76">If the button does not work, copy and paste this URL into your browser:</p>
<p style="text-align:left;overflow-wrap:anywhere;font-size:12px"><a href="{{reset_url}}" style="color:#126b70;text-decoration:underline">{{reset_url}}</a></p>
<p style="text-align:left;font-size:13px;line-height:1.6">If you did not request this, ignore this email. Your password has not changed.</p>
<hr style="border:1px solid #dce7e9"><p style="font-size:12px;color:#526b76">{{company_name}}</p>
</td></tr></table></td></tr></table>""",
    text="Hello {{recipient_name}},\n\nA password reset was requested for your EVEXIA account.\n\n{{reset_url}}\n\nThis link expires in {{expiry_minutes}} minutes and can be used once. If you did not request this, ignore this email. Your password has not changed.\n\n— {{company_name}}",
)


def upgrade():
    op.create_table(
        "email_templates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("event_key", sa.String(60), unique=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("provenance", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_email_template_version"),
        sa.CheckConstraint("length(trim(name)) BETWEEN 1 AND 100 AND length(description) <= 500 "
                           "AND length(trim(subject)) BETWEEN 1 AND 200 AND length(trim(html)) BETWEEN 1 AND 100000 "
                           "AND length(trim(text)) BETWEEN 1 AND 20000", name="ck_email_template_bounds"),
        sa.CheckConstraint("(id = 'e7e80000-0000-4000-8000-000000000001' AND event_key IS NOT NULL AND event_key = 'password_recovery') "
                           "OR (id <> 'e7e80000-0000-4000-8000-000000000001' AND event_key IS NULL)",
                           name="ck_email_template_assignment"),
        sa.CheckConstraint("(provenance = 'migration_seed' AND id = 'e7e80000-0000-4000-8000-000000000001' AND created_by IS NULL) "
                           "OR (provenance = 'administrator' AND created_by IS NOT NULL)", name="ck_email_template_provenance"),
    )
    op.create_index("uq_email_template_name", "email_templates", [sa.text("lower(name)")], unique=True)
    import uuid
    table = sa.table("email_templates",
                     *(sa.column(k, sa.Uuid() if k == "id" else sa.Text()) for k in SEED),
                     sa.column("version", sa.Integer()), sa.column("event_key", sa.Text()),
                     sa.column("provenance", sa.Text()))
    op.bulk_insert(table, [{**SEED, "id": uuid.UUID(SEED["id"]), "version": 1,
                            "event_key": "password_recovery", "provenance": "migration_seed"}])
    op.execute("""
        CREATE FUNCTION protect_recovery_email_template() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP = 'TRUNCATE' THEN
            RAISE EXCEPTION 'Required recovery template cannot be removed';
          END IF;
          IF TG_OP = 'UPDATE' THEN
            IF NEW.id <> OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
               OR NEW.provenance <> OLD.provenance THEN
              RAISE EXCEPTION 'Template identity and creation provenance are immutable';
            END IF;
            IF OLD.id = 'e7e80000-0000-4000-8000-000000000001'
               AND NEW.event_key IS DISTINCT FROM OLD.event_key THEN
              RAISE EXCEPTION 'Required recovery assignment is immutable';
            END IF;
            RETURN NEW;
          END IF;
          IF OLD.id = 'e7e80000-0000-4000-8000-000000000001' THEN
            RAISE EXCEPTION 'Required recovery template cannot be removed';
          END IF;
          RETURN OLD;
        END $$;
        CREATE TRIGGER protect_recovery_email_delete BEFORE DELETE ON email_templates
          FOR EACH ROW EXECUTE FUNCTION protect_recovery_email_template();
        CREATE TRIGGER protect_email_identity_update BEFORE UPDATE ON email_templates
          FOR EACH ROW EXECUTE FUNCTION protect_recovery_email_template();
        CREATE TRIGGER protect_recovery_email_truncate BEFORE TRUNCATE ON email_templates
          FOR EACH STATEMENT EXECUTE FUNCTION protect_recovery_email_template();
    """)


def downgrade():
    raise RuntimeError("Email template removal requires an approved coordinated restore, not automatic downgrade.")
