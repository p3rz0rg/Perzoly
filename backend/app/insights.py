"""Rule-based AI Coach: budget nudges, recurring-charge detection, anomalies,
trends and cash-flow forecasting. Runs entirely offline on local data."""

import statistics
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Budget, Category, Transaction, User


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return date(y, m + 1, 1)


def _user_transactions(db: Session, user_id: int, since: date | None = None):
    q = (
        select(Transaction)
        .join(Transaction.account)
        .where(Transaction.account.has(user_id=user_id))
    )
    if since:
        q = q.where(Transaction.date >= since)
    return db.scalars(q).all()


def detect_recurring(db: Session, user_id: int) -> list[dict]:
    """Merchants appearing 3+ times with similar amounts at regular intervals."""
    txs = _user_transactions(db, user_id)
    by_merchant: dict[str, list[Transaction]] = defaultdict(list)
    for t in txs:
        if t.amount < 0:
            key = t.description.strip().lower()[:40]
            by_merchant[key].append(t)

    recurring = []
    for merchant, items in by_merchant.items():
        if len(items) < 3:
            continue
        items.sort(key=lambda t: t.date)
        amounts = [abs(t.amount) for t in items]
        mean_amt = statistics.mean(amounts)
        if mean_amt == 0 or (statistics.pstdev(amounts) / mean_amt) > 0.15:
            continue
        gaps = [(b.date - a.date).days for a, b in zip(items, items[1:])]
        mean_gap = statistics.mean(gaps)
        if not (20 <= mean_gap <= 40 or 5 <= mean_gap <= 9):
            continue
        cadence = "monthly" if mean_gap >= 20 else "weekly"
        monthly_cost = mean_amt if cadence == "monthly" else mean_amt * 4.33
        recurring.append(
            {
                "merchant": items[-1].description.strip(),
                "occurrences": len(items),
                "cadence": cadence,
                "average_amount": round(mean_amt, 2),
                "monthly_cost": round(monthly_cost, 2),
                "yearly_cost": round(monthly_cost * 12, 2),
                "last_charged": items[-1].date.isoformat(),
            }
        )
    recurring.sort(key=lambda r: -r["monthly_cost"])
    return recurring


def category_anomalies(db: Session, user_id: int, today: date | None = None) -> list[dict]:
    """Categories where current-month spend exceeds mean + 2 sigma of prior months."""
    today = today or date.today()
    txs = _user_transactions(db, user_id)
    per_cat_month: dict[int, dict[date, float]] = defaultdict(lambda: defaultdict(float))
    for t in txs:
        if t.amount < 0 and t.category_id:
            per_cat_month[t.category_id][_month_start(t.date)] += abs(t.amount)

    current = _month_start(today)
    anomalies = []
    for cat_id, months in per_cat_month.items():
        history = [v for m, v in months.items() if m < current]
        if len(history) < 2 or current not in months:
            continue
        mean, sigma = statistics.mean(history), statistics.pstdev(history)
        threshold = mean + 2 * sigma
        if months[current] > threshold and months[current] > mean * 1.2:
            cat = db.get(Category, cat_id)
            anomalies.append(
                {
                    "category": cat.name if cat else str(cat_id),
                    "current_month": round(months[current], 2),
                    "historical_average": round(mean, 2),
                    "threshold": round(threshold, 2),
                }
            )
    return anomalies


def cashflow_forecast(db: Session, user_id: int, today: date | None = None) -> dict:
    """Project end-of-month net based on this month so far + recurring bills due."""
    today = today or date.today()
    start = _month_start(today)
    next_month = _add_months(start, 1)
    txs = _user_transactions(db, user_id)

    month_net = sum(t.amount for t in txs if start <= t.date <= today)
    days_elapsed = max((today - start).days + 1, 1)
    days_total = (next_month - start).days
    daily_expense = sum(t.amount for t in txs if start <= t.date <= today and t.amount < 0) / days_elapsed
    projected = month_net + daily_expense * (days_total - days_elapsed)

    upcoming = []
    for r in detect_recurring(db, user_id):
        last = date.fromisoformat(r["last_charged"])
        next_due = last + timedelta(days=30 if r["cadence"] == "monthly" else 7)
        if today < next_due < next_month:
            upcoming.append({"merchant": r["merchant"], "amount": r["average_amount"], "due": next_due.isoformat()})

    return {
        "month_to_date_net": round(month_net, 2),
        "projected_end_of_month_net": round(projected, 2),
        "upcoming_bills": upcoming,
        "overdraft_risk": projected < 0,
    }


def coach_insights(db: Session, user_id: int, today: date | None = None) -> list[dict]:
    """The proactive-nudge feed shown in the app."""
    today = today or date.today()
    start = _month_start(today)
    insights: list[dict] = []
    user = db.get(User, user_id)
    txs = _user_transactions(db, user_id)

    # --- budget vs actual ---
    budgets = db.scalars(select(Budget).where(Budget.user_id == user_id)).all()
    spent_by_cat: dict[int, float] = defaultdict(float)
    for t in txs:
        if t.amount < 0 and t.category_id and t.date >= start:
            spent_by_cat[t.category_id] += abs(t.amount)
    month_fraction = ((today - start).days + 1) / 30.0
    for b in budgets:
        spent = spent_by_cat.get(b.category_id, 0.0)
        pct = spent / b.monthly_limit * 100 if b.monthly_limit else 0
        if pct >= 100:
            insights.append(
                {
                    "severity": "alert",
                    "kind": "budget",
                    "message": f"{b.category.name}: you've spent {spent:.0f} — {pct:.0f}% of your "
                    f"{b.monthly_limit:.0f} monthly budget. Time to pump the brakes.",
                }
            )
        elif month_fraction > 0 and pct > month_fraction * 100 + 25:
            insights.append(
                {
                    "severity": "warning",
                    "kind": "budget",
                    "message": f"{b.category.name}: {pct:.0f}% of budget used but the month is only "
                    f"{month_fraction * 100:.0f}% done. You're pacing over.",
                }
            )

    # --- behavioral trend: this month vs 3-month average per category ---
    three_months_ago = _add_months(start, -3)
    per_cat_hist: dict[int, float] = defaultdict(float)
    for t in txs:
        if t.amount < 0 and t.category_id and three_months_ago <= t.date < start:
            per_cat_hist[t.category_id] += abs(t.amount)
    for cat_id, hist_total in per_cat_hist.items():
        avg = hist_total / 3
        current = spent_by_cat.get(cat_id, 0.0)
        if avg >= 20 and current > avg * 1.4:
            cat = db.get(Category, cat_id)
            insights.append(
                {
                    "severity": "info",
                    "kind": "trend",
                    "message": f"{cat.name if cat else cat_id} spending is up "
                    f"{(current / avg - 1) * 100:.0f}% vs your 3-month average.",
                }
            )

    # --- subscriptions ---
    recurring = detect_recurring(db, user_id)
    if recurring:
        total = sum(r["monthly_cost"] for r in recurring)
        insights.append(
            {
                "severity": "info",
                "kind": "subscriptions",
                "message": f"{len(recurring)} recurring charges detected totalling "
                f"{total:.0f}/month ({total * 12:.0f}/year). Review them in Reports → Subscription Audit.",
            }
        )

    # --- cash flow ---
    forecast = cashflow_forecast(db, user_id, today)
    if forecast["overdraft_risk"]:
        insights.append(
            {
                "severity": "alert",
                "kind": "cashflow",
                "message": f"Projected end-of-month net is {forecast['projected_end_of_month_net']:.0f}. "
                "At this pace you may overdraft before month end.",
            }
        )

    # --- anomalies ---
    for a in category_anomalies(db, user_id, today):
        insights.append(
            {
                "severity": "warning",
                "kind": "anomaly",
                "message": f"{a['category']} is unusually high this month "
                f"({a['current_month']:.0f} vs typical {a['historical_average']:.0f}).",
            }
        )

    if not insights:
        insights.append(
            {
                "severity": "info",
                "kind": "general",
                "message": f"All quiet, {user.name if user else 'there'} — spending is within normal patterns.",
            }
        )
    return insights
