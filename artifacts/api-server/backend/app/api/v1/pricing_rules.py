import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.services.auth import Identity
from app.services import pricing_rules as service
from app.schemas.pricing_rules import (
    ItPricingRuleInput, ItPricingRuleEdit, ItPricingRuleSaved,
    ItPricingRulePage, ItPricingReferencePage,
)
from app.schemas.category_count_tariffs import (
    CategoryCountTariffInput, CategoryCountTariffSaved,
    CategoryCountTariffView, CategoryCountTariffCategoryPage,
)
from app.services import category_count_tariffs

router = APIRouter(prefix="/admin/pricing-rules", tags=["IT Pricing Rules"])
manager = require_permissions("admin.access")


@router.get("/count-tariffs/categories", response_model=CategoryCountTariffCategoryPage, operation_id="listCategoryCountTariffCategories")
def count_categories(query: str = Query("", max_length=100), offset: int = Query(0, ge=0, le=1000000),
                     limit: int = Query(50, ge=1, le=100), savedOnly: bool = False,
                     actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return category_count_tariffs.categories(db, actor, query, offset, limit, savedOnly)


@router.get("/count-tariffs/{category_id}", response_model=CategoryCountTariffView, operation_id="getCategoryCountTariffs")
def count_history(category_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return category_count_tariffs.history(db, actor, category_id)


@router.post("/count-tariffs", response_model=CategoryCountTariffSaved, operation_id="appendCategoryCountTariff")
def append_count_tariff(body: CategoryCountTariffInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return category_count_tariffs.save(db, actor, body)


@router.get("", response_model=ItPricingRulePage, operation_id="listItPricingRules")
def listing(offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
            query: str = Query("", max_length=100),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.listing(db, actor, offset, limit, query)


@router.get("/references/{kind}", response_model=ItPricingReferencePage, operation_id="getItPricingRuleReferences")
def references(kind: Literal["categories", "allergens"], query: str = Query("", max_length=200),
               categoryId: uuid.UUID | None = None, offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(25, ge=1, le=100),
               categoryIds: list[uuid.UUID] | None = Query(None, min_length=1, max_length=100),
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.references(db, actor, kind, query, offset, limit, categoryId, categoryIds)


@router.get("/{record_id}", response_model=ItPricingRuleSaved, operation_id="getItPricingRule")
def detail(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.detail(db, actor, record_id)


@router.post("", response_model=ItPricingRuleSaved, status_code=201, operation_id="createItPricingRule")
def create(body: ItPricingRuleInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.save(db, actor, body)


@router.post("/{record_id}/edit", response_model=ItPricingRuleSaved, operation_id="editItPricingRule")
def edit(record_id: uuid.UUID, body: ItPricingRuleEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.save(db, actor, body, record_id)
