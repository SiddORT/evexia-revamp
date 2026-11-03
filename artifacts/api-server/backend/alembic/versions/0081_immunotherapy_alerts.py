"""Dedicated MR Immunotherapy placement authoring; no event backfill or replay."""
from alembic import op
import sqlalchemy as sa
import uuid

revision = "0081_immunotherapy_alerts"
down_revision = "0080_admin_email"
branch_labels = depends_on = None

EVENT = "mr_immunotherapy_placed"
EMAIL_ID = "e7e80000-0000-4000-8000-000000000004"
TEXT = ("Notification: MR {{mr_name}} has placed an immunotherapy order for patient "
        "{{patient_name}} on {{placement_date}}.\n"
        "Kindly note the same for your records.\n– Team AllergyEvexia")
HTML = ("<p>Notification: MR {{mr_name}} has placed an immunotherapy order for patient "
        "{{patient_name}} on {{placement_date}}.</p>"
        "<p>Kindly note the same for your records.</p><p>– Team AllergyEvexia</p>")


def upgrade():
    # Freeze the predecessor assignments here; never import evolving ORM models
    # or renderer contracts into historical migration execution.
    ids = [f"e7e80000-0000-4000-8000-{n:012d}" for n in range(1, 5)]
    events = ["password_recovery", "account_invitation", "mr_invitation", EVENT]
    op.drop_constraint("ck_email_template_assignment", "email_templates", type_="check")
    op.create_check_constraint("ck_email_template_assignment", "email_templates",
        " OR ".join(f"(id = '{identity}' AND event_key IS NOT NULL AND event_key = '{event}')"
                    for identity, event in zip(ids, events)) +
        " OR (id NOT IN (" + ",".join(f"'{identity}'" for identity in ids) + ") AND event_key IS NULL)")
    op.drop_constraint("ck_email_template_provenance", "email_templates", type_="check")
    op.create_check_constraint("ck_email_template_provenance", "email_templates",
        "(provenance = 'migration_seed' AND id IN (" +
        ",".join(f"'{identity}'" for identity in ids) +
        ") AND created_by IS NULL) OR (provenance = 'administrator' AND created_by IS NOT NULL)")
    db = op.get_bind()
    # Do not overwrite any authored row, including a coincidentally equal name.
    def unused_name(table, channel=None):
        base = "MR Immunotherapy order placement"
        for suffix in range(1, 104):
            name = base if suffix == 1 else f"{base} · System {suffix}"
            query = f"SELECT id FROM {table} WHERE lower(name)=lower(:name)"
            params = {"name": name}
            if channel:
                query += " AND channel=:channel"
                params["channel"] = channel
            if db.scalar(sa.text(query), params) is None:
                return name
        raise RuntimeError("Placement template name requires operator review.")
    # Existing user capacity is retained; this single required record extends
    # the predecessor's 102-record bound to 103.
    db.execute(sa.text(
        "INSERT INTO email_templates "
        "(id,name,description,subject,html,text,event_key,version,provenance) "
        "VALUES (:id,:name,:description,:subject,:html,:text,:event,1,'migration_seed')"),
        dict(id=uuid.UUID(EMAIL_ID), name=unused_name("email_templates"),
             description="New MR Immunotherapy placements: automatic email to protected Super Admin only.",
             subject="Notification: MR Immunotherapy order placed", html=HTML, text=TEXT, event=EVENT))
    # Authoring only, even if enabled/metadata is later edited. No invented IDs.
    for channel, suffix in (("sms", 1), ("waba", 2)):
        db.execute(sa.text(
            "INSERT INTO order_event_templates "
            "(id,channel,event_key,name,enabled,version,subject,html,text,dlt_id,provider_template,language,parameters) "
            "VALUES (:id,:channel,:event,:name,false,1,'','',:text,'','','','[]'::jsonb)"),
            dict(id=uuid.UUID(f"e7e90000-0000-4000-8000-{suffix:012d}"), channel=channel,
                 event=EVENT, name=unused_name("order_event_templates", channel), text=TEXT))


def downgrade():
    raise RuntimeError("Authored placement templates require a reviewed forward change.")
