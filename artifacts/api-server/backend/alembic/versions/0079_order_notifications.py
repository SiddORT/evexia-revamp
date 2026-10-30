"""Forward-only order event feeds, shared templates and committed delivery intent."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

revision = "0079_order_notifications"
down_revision = "0078_reserve_movements"
branch_labels = depends_on = None


def upgrade():
    op.create_table("order_notification_origins",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("order_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id")),
        sa.Column("mr_id", sa.UUID(), sa.ForeignKey("mr_profiles.id")),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.UniqueConstraint("kind", "order_id", name="uq_order_notification_origin"))
    op.create_table("order_notification_events",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("order_id", sa.UUID(), nullable=False),
        sa.Column("source_key", sa.String(100), nullable=False),
        sa.Column("event", sa.String(40), nullable=False),
        sa.Column("placer_user_id", sa.UUID(), sa.ForeignKey("users.id")),
        sa.Column("placer_mr_id", sa.UUID(), sa.ForeignKey("mr_profiles.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.UniqueConstraint("kind", "order_id", "source_key", name="uq_order_notification_source"),
        sa.CheckConstraint("kind IN ('immunotherapy','spt','lupin','kits')", name="ck_order_notification_kind"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_order_notification_cipher"))
    op.create_index("ix_order_notification_retention", "order_notification_events", ["created_at", "id"])
    op.create_table("order_notification_alerts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("event_id", sa.UUID(), sa.ForeignKey("order_notification_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("event_id", "user_id", name="uq_order_alert_recipient"))
    op.create_index("ix_order_alert_recent", "order_notification_alerts", ["user_id", "created_at", "id"])
    op.create_index("ix_order_alert_unread", "order_notification_alerts", ["user_id", "read", "created_at"])
    op.create_table("order_notification_deliveries",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("event_id", sa.UUID(), sa.ForeignKey("order_notification_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("channel", sa.String(8), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("category", sa.String(60)),
        sa.Column("configuration_id", sa.UUID()),
        sa.Column("configuration_version", sa.Integer()),
        sa.Column("template_id", sa.UUID()),
        sa.Column("template_version", sa.Integer()),
        sa.Column("destination_index", sa.String(64)),
        sa.Column("lease_token", sa.UUID()),
        sa.Column("lease_until", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("event_id", "user_id", "channel", name="uq_order_delivery_recipient"),
        sa.CheckConstraint("channel IN ('email','sms','waba')", name="ck_order_delivery_channel"),
        sa.CheckConstraint("status IN ('pending','leased','sending','accepted','failed','unknown','blocked')", name="ck_order_delivery_status"))
    op.create_index("ix_order_delivery_work", "order_notification_deliveries", ["status", "created_at", "id"])
    op.create_index("ix_order_delivery_recent", "order_notification_deliveries", ["created_at", "id"])
    op.create_table("order_event_templates",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("channel", sa.String(8), nullable=False),
        sa.Column("event_key", sa.String(40)),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("dlt_id", sa.String(60), nullable=False),
        sa.Column("provider_template", sa.String(100), nullable=False),
        sa.Column("language", sa.String(20), nullable=False),
        sa.Column("parameters", postgresql.JSONB(), nullable=False),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id")),
        sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id")),
        sa.UniqueConstraint("channel", "event_key", name="uq_order_template_event"),
        sa.CheckConstraint("channel IN ('email','sms','waba')", name="ck_order_template_channel"),
        sa.CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_order_template_version"))
    op.create_index("uq_order_template_name", "order_event_templates", ["channel", sa.text("lower(name)")], unique=True)
    # Only authored source is seeded. Never read, scan or backfill order history.
    table = sa.table("order_event_templates",
        sa.column("id", sa.UUID()), sa.column("channel"), sa.column("event_key"), sa.column("name"),
        sa.column("enabled", sa.Boolean()), sa.column("version", sa.Integer()),
        sa.column("subject"), sa.column("html"), sa.column("text"), sa.column("dlt_id"),
        sa.column("provider_template"), sa.column("language"), sa.column("parameters", postgresql.JSONB()))
    labels = (
        ("order_placed", "Order placed", "has been placed"),
        ("order_confirmed", "Order confirmed", "has been confirmed"),
        ("order_rejected", "Order rejected", "has been rejected"),
        ("order_resubmitted", "Order resubmitted", "has been resubmitted for review"),
        ("order_shipped", "Order shipped", "has been shipped"),
        ("order_delivered", "Order delivered", "has a recorded delivery"),
        ("order_returned", "Order returned", "has been returned"),
        ("order_transaction", "MR transaction recorded", "has a recorded MR transaction of INR {{transaction_amount}}"),
    )
    rows = []
    for ci, channel in enumerate(("email", "sms", "waba")):
        for ei, (event, label, phrase) in enumerate(labels):
            content = ("{{company_name}}: {{order_type}} order {{order_number}} " + phrase
                       + ". Placing MR: {{mr_name}}. Status: {{status}}. Recorded: {{timestamp}}.")
            rows.append(dict(id=uuid.UUID(f"e7e89750-0000-4000-8000-{ci * 8 + ei + 1:012d}"),
                channel=channel, event_key=event, name=label, enabled=True, version=1,
                subject=label + " · {{order_number}}" if channel == "email" else "",
                html="<p>" + content + "</p>" if channel == "email" else "", text=content,
                dlt_id="", provider_template="", language="", parameters=[]))
    op.bulk_insert(table, rows)
    op.execute("""
      CREATE FUNCTION order_notification_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Saved order notification facts are immutable'; END $$;
      CREATE TRIGGER order_notification_event_immutable BEFORE UPDATE ON order_notification_events
        FOR EACH ROW EXECUTE FUNCTION order_notification_immutable();
      CREATE TRIGGER order_notification_origin_immutable BEFORE UPDATE OR DELETE ON order_notification_origins
        FOR EACH ROW EXECUTE FUNCTION order_notification_immutable();
    """)


def downgrade():
    raise RuntimeError("Notification history cannot be discarded by downgrade.")
