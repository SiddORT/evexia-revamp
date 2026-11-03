"""Enrich the assigned placement email only; no outbox changes or replay."""
from html.parser import HTMLParser
from alembic import op
import sqlalchemy as sa
import uuid

revision = "0085_placement_email_details"
down_revision = "0084_allergen_expiry"
branch_labels = depends_on = None

EMAIL_ID = uuid.UUID("e7e80000-0000-4000-8000-000000000004")
EVENT = "mr_immunotherapy_placed"


class SourceFacts(HTMLParser):
    """Frozen content inspection, independent of evolving application renderers."""
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.visible = []
        self.has_order_link = False
        self.feed(source)
        self.close()

    def handle_data(self, data):
        self.visible.append(data)

    def handle_starttag(self, tag, attrs):
        if tag == "a" and ("href", "{{order_details_url}}") in attrs:
            self.has_order_link = True


def upgrade():
    db = op.get_bind()
    # Same lock as the Email Templates editor, followed by the row lock. Read
    # the latest authored content, never an assumed version-1/default snapshot.
    db.execute(sa.text("SELECT pg_advisory_xact_lock(5310043)"))
    row = db.execute(sa.text(
        "SELECT subject,html,text,version FROM email_templates "
        "WHERE id=:id AND event_key=:event FOR UPDATE"),
        dict(id=EMAIL_ID, event=EVENT)).mappings().one_or_none()
    if row is None:
        raise RuntimeError("Assigned placement email unavailable; restore its assignment before upgrade.")
    html, text = row["html"], row["text"]
    parsed = SourceFacts(html)
    visible = "".join(parsed.visible)
    # Preserve original wording, styles, metadata and attribution. Append only
    # missing sections; an already enriched or partially enriched row is safe.
    if "{{allergen_list}}" not in visible:
        html += "<p><strong>Allergens:</strong></p><div>{{allergen_list}}</div>"
    if "{{allergen_list}}" not in text:
        text += "\n\nAllergens:\n{{allergen_list}}"
    if not parsed.has_order_link:
        html += '<p><a href="{{order_details_url}}">View order details</a></p>'
    if "{{order_details_url}}" not in visible:
        html += "<p>Order URL: {{order_details_url}}</p>"
    if "{{order_details_url}}" not in text:
        text += "\n\nView order details: {{order_details_url}}"
    if (html, text) == (row["html"], row["text"]):
        return
    if len(html) > 100000 or len(text) > 20000 or row["version"] >= 2147483647:
        raise RuntimeError("Placement email needs administrator reconciliation before enrichment.")
    changed = db.execute(sa.text(
        "UPDATE email_templates SET html=:html,text=:text,version=version+1,updated_at=now() "
        "WHERE id=:id AND event_key=:event AND version=:version"),
        dict(id=EMAIL_ID, event=EVENT, version=row["version"], html=html, text=text))
    if changed.rowcount != 1:
        raise RuntimeError("Placement email changed; retry upgrade against the latest saved version.")
    # Existing delivery version checks intentionally block pending old versions.
    # Do not touch event payloads, attempts, SMS/WABA rows or applied migrations.


def downgrade():
    raise RuntimeError("Authored placement email additions require a reviewed forward change.")
