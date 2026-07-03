# Perzoly

Local-first household expense tracker for two people. Import bank statements
(CSV, Excel, OFX/QFX, QIF), auto-categorize transactions, track budgets, split
shared expenses, and get rule-based coaching insights — all offline, all your
data stays in a local SQLite file.

Full feature specification: [docs/spec.md](docs/spec.md)

## Stack

- **Backend** — FastAPI + SQLAlchemy + SQLite + pandas ([backend/](backend/))
- **Frontend** — React + TypeScript + Vite + Recharts ([frontend/](frontend/))

## Run locally (dev)

```bash
./dev.sh
```

First run installs everything (needs Python 3.12+ and Node; the script picks up
`uv` and `nvm` automatically). Then open:

- App: http://localhost:5173
- API docs: http://localhost:8000/docs

## Run with Docker (single container)

```bash
docker compose up --build
# or:
docker build -t perzoly . && docker run -p 8000:8000 -v perzoly-data:/data perzoly
```

Open http://localhost:8000 — one container serves both the API and the built
frontend. Your data lives in the `perzoly-data` volume (`/data/perzoly.db`).

## Try it out

Two sample statements in different bank formats live in [samples/](samples/):

1. Open **My Accounts**, add an account, drop in `samples/bank_a_my_account.csv`
   (US format: comma-separated, MM/DD/YYYY, signed amounts).
2. Open **Wife's Accounts**, add an account, drop in
   `samples/bank_b_wife_account.csv` (PT format: semicolon-separated,
   DD/MM/YYYY, débito/crédito columns, comma decimals).
3. Check **Combined View** and **Reports** — comparison charts, subscription
   audit, budget alerts, and cash-flow forecast light up.

## What's in the MVP

- Multi-format import with delimiter/encoding/date-format auto-detection
- Duplicate detection (date + amount + description hash), import undo/rollback
- Keyword auto-categorization (incl. common PT merchants), review flags
- Manual transaction entry, notes, inline category editing
- Monthly budgets with pacing alerts
- Shared-expense tagging with split ratios and settle-up calculation
- Combined household view: side-by-side category comparison, savings rates
- Coach insights: budget nudges, trend shifts, anomaly detection (2σ),
  subscription hunting, cash-flow / overdraft forecast

## Not yet implemented (from the spec)

Auth/2FA, encryption at rest, email ingestion, receipt OCR, multi-currency
conversion, external integrations (Zapier, calendar), and Postgres — planned
for the cloud phase.
