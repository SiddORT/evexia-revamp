"""Invitation onboarding and encrypted transactional email evidence."""
from alembic import op
import sqlalchemy as sa

revision = "0053_email_invitations"
down_revision = "0052_hq_mr_zones_merge"
branch_labels = depends_on = None

SEED = dict(
    id="e7e80000-0000-4000-8000-000000000002",
    name="Invite staff member",
    description="Set-password invitation for saved eligible staff and MR accounts.",
    subject="Your EVEXIA {{portal_name}} invitation",
    html='<div style="font-family:Arial,sans-serif;color:#203b48;padding:28px">'
         '<img src="/images/evexia-logo.png" alt="EVEXIA Life Sciences" width="154">'
         '<h1>Welcome to EVEXIA</h1><p>Hello {{recipient_name}},</p>'
         '<p>You are invited to the {{portal_name}} portal. Your User ID is {{login_id}}.</p>'
         '<p><a href="{{reset_url}}" style="background-color:#126b70;color:#ffffff;padding:14px">Set password</a></p>'
         '<p>This one-use link expires in {{expiry_minutes}} minutes.</p>'
         '<p>If the button does not work, use <a href="{{reset_url}}">{{reset_url}}</a>.</p>'
         '<p>If unexpected, ignore this email. Existing credentials remain unchanged until acceptance.</p>'
         '<p>{{company_name}}</p></div>',
    text="Hello {{recipient_name}},\nYou are invited to the EVEXIA {{portal_name}} portal.\n"
         "Your User ID is {{login_id}}.\nSet password: {{reset_url}}\n"
         "This one-use link expires in {{expiry_minutes}} minutes.\n"
         "If unexpected, ignore this email. Existing credentials remain unchanged until acceptance.\n{{company_name}}",
)


def upgrade():
    op.add_column("users", sa.Column("password_setup_required", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.drop_constraint("ck_email_template_assignment", "email_templates")
    op.drop_constraint("ck_email_template_provenance", "email_templates")
    op.create_check_constraint("ck_email_template_assignment", "email_templates",
        "(id = 'e7e80000-0000-4000-8000-000000000001' AND event_key IS NOT NULL AND event_key='password_recovery') OR "
        "(id = 'e7e80000-0000-4000-8000-000000000002' AND event_key IS NOT NULL AND event_key='account_invitation') OR "
        "(id NOT IN ('e7e80000-0000-4000-8000-000000000001','e7e80000-0000-4000-8000-000000000002') AND event_key IS NULL)")
    op.create_check_constraint("ck_email_template_provenance", "email_templates",
        "(provenance='migration_seed' AND id IN ('e7e80000-0000-4000-8000-000000000001',"
        "'e7e80000-0000-4000-8000-000000000002') AND created_by IS NULL) OR "
        "(provenance='administrator' AND created_by IS NOT NULL)")
    import uuid
    table = sa.table("email_templates", *(sa.column(k, sa.Uuid() if k == "id" else sa.Text()) for k in SEED),
                     sa.column("version", sa.Integer()), sa.column("event_key", sa.Text()), sa.column("provenance", sa.Text()))
    # Preserve administrator-authored unassigned content, even a name collision.
    # Never rename or overwrite an existing template to make room for the seed.
    name = SEED["name"]
    connection = op.get_bind()
    suffix = 0
    while connection.scalar(sa.text("SELECT 1 FROM email_templates WHERE lower(name)=lower(:name)"), {"name": name}):
        suffix += 1
        name = f"Invite staff member (required {suffix})"
    op.bulk_insert(table, [{**SEED, "name": name, "id": uuid.UUID(SEED["id"]), "version": 1,
                           "event_key": "account_invitation", "provenance": "migration_seed"}])
    op.execute("""
      CREATE OR REPLACE FUNCTION protect_recovery_email_template() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'Required templates cannot be removed'; END IF;
        IF TG_OP = 'UPDATE' THEN
          IF NEW.id <> OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.provenance <> OLD.provenance THEN
            RAISE EXCEPTION 'Template identity and provenance are immutable';
          END IF;
          IF OLD.event_key IS NOT NULL AND NEW.event_key IS DISTINCT FROM OLD.event_key THEN
            RAISE EXCEPTION 'Required template assignment is immutable';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.event_key IS NOT NULL THEN RAISE EXCEPTION 'Required templates cannot be removed'; END IF;
        RETURN OLD;
      END $$;
    """)
    op.create_table("email_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("recipient_ciphertext", sa.Text()), sa.Column("recipient_index", sa.String(64)),
        sa.Column("purpose", sa.String(32), nullable=False), sa.Column("portal", sa.String(8), nullable=False),
        sa.Column("template_id", sa.Uuid(), sa.ForeignKey("email_templates.id")),
        sa.Column("template_version", sa.Integer()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("failure_category", sa.String(32)),
        sa.CheckConstraint("purpose IN ('password_recovery','account_invitation')", name="ck_email_attempt_purpose"),
        sa.CheckConstraint("status IN ('pending','sending','smtp_accepted','failed','unknown')", name="ck_email_attempt_status"),
        sa.CheckConstraint("portal IN ('admin','mr')", name="ck_email_attempt_portal"),
        sa.CheckConstraint("(recipient_ciphertext IS NULL) = (recipient_index IS NULL) "
                           "AND (recipient_ciphertext IS NULL OR recipient_ciphertext LIKE 'v1:%')",
                           name="ck_email_attempt_recipient"))
    op.create_index("ix_email_attempt_created", "email_attempts", ["created_at", "id"])
    op.create_index("ix_email_attempt_recipient", "email_attempts", ["recipient_index", "created_at"])


def downgrade():
    raise RuntimeError("Email onboarding/evidence requires coordinated recovery; automatic downgrade refused.")
