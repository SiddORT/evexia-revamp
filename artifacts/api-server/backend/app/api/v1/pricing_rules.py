"""Combination pricing only. Retired material/count endpoints are not exposed."""
import uuid
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Literal
from app.api.deps import require_permissions
from app.db.session import get_db
from app.services.auth import Identity
from app.services import combination_pricing, combination_rules
from app.schemas.combination_pricing import (
    CombinationGenerate, CombinationSave, CombinationPage, CombinationResult,
    CombinationHistory, CombinationAllergenPage, CombinationCategoryPage,
    CombinationSavedPage, CombinationSavedRule, CombinationStatusInput,
    CombinationStatusResult, CombinationStatusHistory,
)
from app.schemas.immunotherapy_extract import Dosage

router = APIRouter(prefix="/admin/pricing-rules", tags=["IT Pricing Rules"])
manager = require_permissions("admin.access")


@router.get("/combinations/rules", response_model=CombinationSavedPage, operation_id="listSavedCombinationRules")
def saved_combination_rules(query: str = Query("", max_length=100),
                            status: Literal["all", "active", "inactive"] = "all",
                            offset: int = Query(0, ge=0, le=1000000), limit: int = Query(10, ge=1, le=100),
                            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_rules.listing(db, actor, query, status, offset, limit)


@router.get("/combinations/rules/{record_id}", response_model=CombinationSavedRule, operation_id="getSavedCombinationRule")
def saved_combination_rule(record_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_rules.detail(db, actor, record_id)


@router.post("/combinations/rules/{record_id}/status", response_model=CombinationStatusResult, operation_id="changeCombinationRuleStatus")
def combination_rule_status(record_id: uuid.UUID, body: CombinationStatusInput,
                            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_rules.change_status(db, actor, record_id, body)


@router.get("/combinations/rules/{record_id}/status-history", response_model=CombinationStatusHistory, operation_id="getCombinationRuleStatusHistory")
def combination_rule_status_history(record_id: uuid.UUID, offset: int = Query(0, ge=0, le=1000000),
                                   limit: int = Query(25, ge=1, le=100),
                                   actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_rules.history(db, actor, record_id, offset, limit)


@router.get("/combinations/categories", response_model=CombinationCategoryPage, operation_id="listCombinationPricingCategories")
def categories(query: str = Query("", max_length=100), offset: int = Query(0, ge=0, le=1000000),
               limit: int = Query(50, ge=1, le=100),
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_pricing.categories(db, actor, query, offset, limit)


@router.get("/combinations/allergens/{category_id}", response_model=CombinationAllergenPage, operation_id="listCombinationPricingAllergens")
def allergens(category_id: uuid.UUID, query: str = Query("", max_length=100),
              offset: int = Query(0, ge=0, le=1000000), limit: int = Query(50, ge=1, le=100),
              actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_pricing.allergens(db, actor, category_id, query, offset, limit)


@router.post("/combinations/generate", response_model=CombinationPage, operation_id="generateCombinationPricingRows")
def generate(body: CombinationGenerate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_pricing.generate(db, actor, body)


@router.post("/combinations/save", response_model=CombinationResult, operation_id="saveCombinationPricingBatch")
def save(body: CombinationSave, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_pricing.save(db, actor, body)


@router.get("/combinations/history/{category_id}", response_model=CombinationHistory, operation_id="getCombinationPricingHistory")
def history(category_id: uuid.UUID, dosage: Dosage, memberKey: str = Query("", max_length=110),
            offset: int = Query(0, ge=0, le=1000000), limit: int = Query(25, ge=1, le=100),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return combination_pricing.history(db, actor, category_id, dosage, memberKey, offset, limit)
