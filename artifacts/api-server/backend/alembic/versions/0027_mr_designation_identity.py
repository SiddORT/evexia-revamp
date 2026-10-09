"""Bind every historical MR designation to exactly one catalogue identity."""
from alembic import op
import sqlalchemy as sa

revision = "0027_mr_designation_identity"
down_revision = "0026_designation_target"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    # Prevent catalogue or MR writers changing the preflight/backfill snapshot.
    db.execute(sa.text("LOCK TABLE mr_directory, designations IN ACCESS EXCLUSIVE MODE"))
    normalization = lambda col: f"lower(btrim(regexp_replace({col}, '\\s+', ' ', 'g')))"
    matches = f"{normalization('m.designation')} = {normalization('d.name')}"
    unresolved = db.execute(sa.text(f"""
        SELECT m.id, count(d.id) AS matches
        FROM mr_directory m LEFT JOIN designations d ON {matches}
        GROUP BY m.id HAVING count(d.id) <> 1 ORDER BY m.id LIMIT 20
    """)).all()
    if unresolved:
        details = ", ".join(f"{row.id} ({row.matches} matches)" for row in unresolved)
        raise RuntimeError(
            "MR designation reconciliation required; no schema/data changes applied. "
            "All catalogue history, including inactive/deleted entries, participates. "
            "Review these MR IDs against normalized catalogue names: " + details +
            ". Resolve missing/ambiguous labels through an approved reconciliation procedure, "
            "then retry with writes stopped and a verified backup. No catalogue entries are created.")
    op.add_column("mr_directory", sa.Column("designation_id", sa.Uuid(), nullable=True))
    db.execute(sa.text(f"""
        UPDATE mr_directory m SET designation_id=d.id FROM designations d WHERE {matches}
    """))
    # Existing deferred identity guards must run before ALTER TABLE; do not
    # disable them or commit the backfill separately from the schema replacement.
    db.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    op.alter_column("mr_directory", "designation_id", nullable=False)
    op.create_foreign_key("fk_mr_directory_designation", "mr_directory", "designations",
                          ["designation_id"], ["id"], ondelete="RESTRICT")
    op.drop_column("mr_directory", "designation")


def downgrade():
    # Catalogue renames mean even current names cannot reconstruct original text.
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM mr_directory)")):
        raise RuntimeError(
            "Populated MR designation downgrade is refused: original labels cannot be "
            "reconstructed after catalogue renames. Use a reviewed forward fix or "
            "coordinated verified backup restore.")
    op.add_column("mr_directory", sa.Column("designation", sa.String(200), nullable=False))
    op.drop_constraint("fk_mr_directory_designation", "mr_directory", type_="foreignkey")
    op.drop_column("mr_directory", "designation_id")
