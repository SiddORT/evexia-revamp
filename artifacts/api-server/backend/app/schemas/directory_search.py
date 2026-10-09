from pydantic import BaseModel, Field


class SearchSection(BaseModel):
    """Counts refer to complete SQL pages only; encrypted sections have no total."""
    partial: bool = False
    scanned: int = Field(default=0, ge=0, le=500)
    nextCursor: str | None = None
