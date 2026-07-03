import os
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import insights as coach
from .database import Base, engine, get_db
from .importer import ImportError_, parse_file, tx_hash
from .models import Account, Budget, Category, ImportBatch, Transaction, User
from .seed import categorize, seed_defaults

Base.metadata.create_all(engine)
with next(get_db()) as _db:
    seed_defaults(_db)

app = FastAPI(title="Perzoly", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB = Annotated[Session, Depends(get_db)]


# ---------- schemas ----------

class AccountIn(BaseModel):
    user_id: int
    name: str
    bank: str = ""
    currency: str = "EUR"


class TransactionIn(BaseModel):
    account_id: int
    date: date
    description: str
    amount: float
    category_id: int | None = None
    notes: str = ""


class TransactionPatch(BaseModel):
    category_id: int | None = None
    notes: str | None = None
    needs_review: bool | None = None
    is_shared: bool | None = None
    split_ratio: float | None = None


class BudgetIn(BaseModel):
    user_id: int
    category_id: int
    monthly_limit: float


def tx_out(t: Transaction) -> dict:
    return {
        "id": t.id,
        "account_id": t.account_id,
        "date": t.date.isoformat(),
        "description": t.description,
        "amount": t.amount,
        "category_id": t.category_id,
        "category": t.category.name if t.category else None,
        "category_color": t.category.color if t.category else "#9ca3af",
        "notes": t.notes,
        "needs_review": t.needs_review,
        "is_shared": t.is_shared,
        "split_ratio": t.split_ratio,
    }


# ---------- users & accounts ----------

@app.get("/api/users")
def list_users(db: DB):
    return [{"id": u.id, "name": u.name} for u in db.scalars(select(User)).all()]


@app.get("/api/accounts")
def list_accounts(db: DB, user_id: int | None = None):
    q = select(Account).options(selectinload(Account.transactions))
    if user_id:
        q = q.where(Account.user_id == user_id)
    out = []
    for a in db.scalars(q).all():
        txs = a.transactions
        out.append(
            {
                "id": a.id,
                "user_id": a.user_id,
                "name": a.name,
                "bank": a.bank,
                "currency": a.currency,
                "balance": round(sum(t.amount for t in txs), 2),
                "transaction_count": len(txs),
                "last_activity": max((t.date for t in txs), default=None),
            }
        )
    return out


@app.post("/api/accounts", status_code=201)
def create_account(body: AccountIn, db: DB):
    if not db.get(User, body.user_id):
        raise HTTPException(404, "user not found")
    acc = Account(**body.model_dump())
    db.add(acc)
    db.commit()
    return {"id": acc.id}


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: DB):
    acc = db.get(Account, account_id)
    if not acc:
        raise HTTPException(404, "account not found")
    db.delete(acc)
    db.commit()


# ---------- categories ----------

@app.get("/api/categories")
def list_categories(db: DB):
    return [
        {"id": c.id, "name": c.name, "keywords": c.keywords, "color": c.color}
        for c in db.scalars(select(Category)).all()
    ]


# ---------- imports ----------

@app.post("/api/imports")
async def import_file(db: DB, account_id: Annotated[int, Form()], file: Annotated[UploadFile, File()]):
    account = db.get(Account, account_id)
    if not account:
        raise HTTPException(404, "account not found")
    content = await file.read()
    try:
        rows = parse_file(file.filename or "upload.csv", content)
    except ImportError_ as e:
        raise HTTPException(422, f"could not parse file: {e}")
    except Exception as e:
        raise HTTPException(422, f"unexpected parse failure: {e}")

    categories = db.scalars(select(Category)).all()
    existing_hashes = set(
        db.scalars(select(Transaction.tx_hash).where(Transaction.account_id == account_id)).all()
    )
    batch = ImportBatch(account_id=account_id, filename=file.filename or "upload")
    db.add(batch)
    db.flush()

    imported = duplicates = 0
    seen_in_file: set[str] = set()
    for row in rows:
        h = tx_hash(row["date"], row["amount"], row["description"])
        if h in existing_hashes or h in seen_in_file:
            duplicates += 1
            continue
        seen_in_file.add(h)
        cat = categorize(row["description"], categories)
        db.add(
            Transaction(
                account_id=account_id,
                date=row["date"],
                description=row["description"],
                amount=row["amount"],
                category_id=cat.id if cat else None,
                needs_review=cat is None,
                tx_hash=h,
                import_batch_id=batch.id,
            )
        )
        imported += 1

    batch.imported_count = imported
    batch.duplicate_count = duplicates
    db.commit()
    return {"batch_id": batch.id, "imported": imported, "duplicates_skipped": duplicates}


@app.get("/api/imports")
def list_imports(db: DB, account_id: int | None = None):
    q = select(ImportBatch).order_by(ImportBatch.created_at.desc())
    if account_id:
        q = q.where(ImportBatch.account_id == account_id)
    return [
        {
            "id": b.id,
            "account_id": b.account_id,
            "filename": b.filename,
            "created_at": b.created_at.isoformat(),
            "imported": b.imported_count,
            "duplicates_skipped": b.duplicate_count,
        }
        for b in db.scalars(q).all()
    ]


@app.delete("/api/imports/{batch_id}", status_code=204)
def rollback_import(batch_id: int, db: DB):
    batch = db.get(ImportBatch, batch_id)
    if not batch:
        raise HTTPException(404, "batch not found")
    for t in batch.transactions:
        db.delete(t)
    db.delete(batch)
    db.commit()


# ---------- transactions ----------

@app.get("/api/transactions")
def list_transactions(
    db: DB,
    user_id: int | None = None,
    account_id: int | None = None,
    category_id: int | None = None,
    search: str | None = None,
    start: date | None = None,
    end: date | None = None,
    needs_review: bool | None = None,
    limit: int = Query(200, le=1000),
    offset: int = 0,
):
    q = (
        select(Transaction)
        .options(selectinload(Transaction.category))
        .order_by(Transaction.date.desc(), Transaction.id.desc())
    )
    if user_id:
        q = q.join(Transaction.account).where(Account.user_id == user_id)
    if account_id:
        q = q.where(Transaction.account_id == account_id)
    if category_id:
        q = q.where(Transaction.category_id == category_id)
    if search:
        q = q.where(Transaction.description.ilike(f"%{search}%"))
    if start:
        q = q.where(Transaction.date >= start)
    if end:
        q = q.where(Transaction.date <= end)
    if needs_review is not None:
        q = q.where(Transaction.needs_review == needs_review)
    return [tx_out(t) for t in db.scalars(q.limit(limit).offset(offset)).all()]


@app.post("/api/transactions", status_code=201)
def create_transaction(body: TransactionIn, db: DB):
    if not db.get(Account, body.account_id):
        raise HTTPException(404, "account not found")
    cat = None
    if body.category_id is None:
        cat = categorize(body.description, db.scalars(select(Category)).all())
    t = Transaction(
        **body.model_dump(exclude={"category_id"}),
        category_id=body.category_id or (cat.id if cat else None),
        tx_hash=tx_hash(body.date, body.amount, body.description),
    )
    db.add(t)
    db.commit()
    return tx_out(t)


@app.patch("/api/transactions/{tx_id}")
def update_transaction(tx_id: int, body: TransactionPatch, db: DB):
    t = db.get(Transaction, tx_id)
    if not t:
        raise HTTPException(404, "transaction not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(t, field, value)
    db.commit()
    return tx_out(t)


@app.delete("/api/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, db: DB):
    t = db.get(Transaction, tx_id)
    if not t:
        raise HTTPException(404, "transaction not found")
    db.delete(t)
    db.commit()


# ---------- budgets ----------

@app.get("/api/budgets")
def list_budgets(db: DB, user_id: int, month: str | None = None):
    """Budgets with current-month (or given YYYY-MM) actuals."""
    ref = date.fromisoformat(f"{month}-01") if month else date.today().replace(day=1)
    next_month = (ref.replace(day=28) + timedelta(days=4)).replace(day=1)
    budgets = db.scalars(
        select(Budget).options(selectinload(Budget.category)).where(Budget.user_id == user_id)
    ).all()
    txs = db.scalars(
        select(Transaction)
        .join(Transaction.account)
        .where(Account.user_id == user_id, Transaction.date >= ref, Transaction.date < next_month)
    ).all()
    spent = defaultdict(float)
    for t in txs:
        if t.amount < 0 and t.category_id:
            spent[t.category_id] += abs(t.amount)
    return [
        {
            "id": b.id,
            "category_id": b.category_id,
            "category": b.category.name,
            "color": b.category.color,
            "monthly_limit": b.monthly_limit,
            "spent": round(spent.get(b.category_id, 0.0), 2),
        }
        for b in budgets
    ]


@app.post("/api/budgets", status_code=201)
def upsert_budget(body: BudgetIn, db: DB):
    existing = db.scalars(
        select(Budget).where(Budget.user_id == body.user_id, Budget.category_id == body.category_id)
    ).first()
    if existing:
        existing.monthly_limit = body.monthly_limit
        db.commit()
        return {"id": existing.id}
    b = Budget(**body.model_dump())
    db.add(b)
    db.commit()
    return {"id": b.id}


@app.delete("/api/budgets/{budget_id}", status_code=204)
def delete_budget(budget_id: int, db: DB):
    b = db.get(Budget, budget_id)
    if not b:
        raise HTTPException(404, "budget not found")
    db.delete(b)
    db.commit()


# ---------- reports ----------

def _period_txs(db: Session, user_id: int | None, start: date | None, end: date | None):
    q = select(Transaction).options(selectinload(Transaction.category), selectinload(Transaction.account))
    if user_id:
        q = q.join(Transaction.account).where(Account.user_id == user_id)
    if start:
        q = q.where(Transaction.date >= start)
    if end:
        q = q.where(Transaction.date <= end)
    return db.scalars(q).all()


@app.get("/api/reports/summary")
def report_summary(db: DB, user_id: int, start: date | None = None, end: date | None = None):
    txs = _period_txs(db, user_id, start, end)
    by_cat: dict[str, dict] = {}
    income = expenses = 0.0
    for t in txs:
        if t.amount >= 0:
            income += t.amount
            continue
        expenses += -t.amount
        name = t.category.name if t.category else "Uncategorized"
        color = t.category.color if t.category else "#9ca3af"
        entry = by_cat.setdefault(name, {"category": name, "color": color, "total": 0.0})
        entry["total"] = round(entry["total"] + -t.amount, 2)
    monthly: dict[str, dict] = {}
    for t in txs:
        key = t.date.strftime("%Y-%m")
        m = monthly.setdefault(key, {"month": key, "income": 0.0, "expenses": 0.0})
        if t.amount >= 0:
            m["income"] = round(m["income"] + t.amount, 2)
        else:
            m["expenses"] = round(m["expenses"] + -t.amount, 2)
    return {
        "income": round(income, 2),
        "expenses": round(expenses, 2),
        "net": round(income - expenses, 2),
        "by_category": sorted(by_cat.values(), key=lambda x: -x["total"]),
        "monthly": sorted(monthly.values(), key=lambda x: x["month"]),
    }


@app.get("/api/reports/comparison")
def report_comparison(db: DB, start: date | None = None, end: date | None = None):
    users = db.scalars(select(User)).all()
    per_user = {}
    shared_expenses = []
    for u in users:
        txs = _period_txs(db, u.id, start, end)
        by_cat: dict[str, float] = defaultdict(float)
        income = expenses = 0.0
        for t in txs:
            if t.amount >= 0:
                income += t.amount
            else:
                expenses += -t.amount
                by_cat[t.category.name if t.category else "Uncategorized"] += -t.amount
            if t.is_shared and t.amount < 0:
                shared_expenses.append(
                    {
                        "user": u.name,
                        "date": t.date.isoformat(),
                        "description": t.description,
                        "amount": abs(t.amount),
                        "split_ratio": t.split_ratio,
                        "owed_by_other": round(abs(t.amount) * (1 - t.split_ratio), 2),
                    }
                )
        per_user[u.name] = {
            "user_id": u.id,
            "income": round(income, 2),
            "expenses": round(expenses, 2),
            "net": round(income - expenses, 2),
            "savings_rate": round((income - expenses) / income * 100, 1) if income else 0.0,
            "by_category": {k: round(v, 2) for k, v in by_cat.items()},
        }
    all_cats = sorted({c for u in per_user.values() for c in u["by_category"]})
    category_comparison = [
        {"category": c, **{name: u["by_category"].get(c, 0.0) for name, u in per_user.items()}}
        for c in all_cats
    ]
    household_net = round(sum(u["net"] for u in per_user.values()), 2)
    return {
        "per_user": per_user,
        "category_comparison": category_comparison,
        "shared_expenses": shared_expenses,
        "household_net": household_net,
    }


@app.get("/api/reports/recurring")
def report_recurring(db: DB, user_id: int):
    return coach.detect_recurring(db, user_id)


@app.get("/api/reports/insights")
def report_insights(db: DB, user_id: int):
    return coach.coach_insights(db, user_id)


@app.get("/api/reports/cashflow")
def report_cashflow(db: DB, user_id: int):
    return coach.cashflow_forecast(db, user_id)


@app.get("/api/reports/anomalies")
def report_anomalies(db: DB, user_id: int):
    return coach.category_anomalies(db, user_id)


# ---------- static frontend (production / Docker) ----------

_static_dir = Path(os.environ.get("PERZOLY_STATIC_DIR", Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"))
if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="frontend")
