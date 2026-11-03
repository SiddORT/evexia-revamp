from typing import Literal
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session
from app.api.deps import current_identity
from app.db.session import get_db
from app.schemas.mr_sales import MRSalesReport, MRSalesYears
from app.services import mr_sales as service

router = APIRouter(prefix="/mr/sales-achievement", tags=["mr-sales-achievement"])


@router.get("/years", response_model=MRSalesYears, operation_id="mrSalesYears")
def years(response: Response, offset: int = Query(0, ge=0, le=10000),
          limit: int = Query(50, ge=1, le=100),
          actor=Depends(current_identity), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return service.years(db, actor, offset, limit)


@router.get("", response_model=MRSalesReport, operation_id="mrSalesAchievement")
def report(response: Response, start_year: int | None = Query(None, ge=1, le=9998),
           period: Literal["all", "Q1", "Q2", "Q3", "Q4"] = "all",
           offset: int = Query(0, ge=0, le=20000), limit: int = Query(25, ge=1, le=100),
           actor=Depends(current_identity), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    return service.reporting(db, actor, start_year, period, offset, limit)
