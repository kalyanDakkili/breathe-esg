# Breathe ESG — Emissions Ingestion Platform

A Django + React prototype for ingesting, normalizing, and reviewing emissions data from SAP, utility portals, and corporate travel platforms.

## Live Demo

**App**: [deployed URL]  
**Login**: `analyst` / `demo1234`

## Local Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

### Frontend

```bash
cd frontend
npm install
# For local dev (proxies /api to localhost:8000):
npm run dev

# For production build:
VITE_API_URL=https://your-backend.com npm run build
```

## Architecture

```
backend/
  config/          Django project settings + URLs
  emissions/       Core data models (Client, SourceBatch, RawRow, EmissionRecord, AuditLog)
  ingestion/       Upload views + parsers
    parsers/
      sap_parser.py      SAP flat-file CSV → EmissionRecord
      utility_parser.py  Utility portal CSV → EmissionRecord
      travel_parser.py   Concur/Navan CSV → EmissionRecord
    management/commands/seed_demo.py

frontend/src/
  pages/
    Login.jsx
    Dashboard.jsx
  components/
    Sidebar.jsx
    Overview.jsx      Scope 1/2/3 summary with recharts
    RecordTable.jsx   Analyst review table with bulk actions + detail modal
    UploadPanel.jsx   File upload with sample CSV download
    BatchList.jsx     Ingestion history
  api.js             Axios client with JWT refresh
```

## Data Model Summary

See [docs/MODEL.md](docs/MODEL.md) for full documentation.

Key design points:
- Multi-tenancy via `Client` FK on all data tables
- `RawRow` stores verbatim source data — never mutated, enables re-processing
- `EmissionRecord` stores both source quantities AND canonical units (kWh, km) to support emission factor recalculation
- `AuditLog` is append-only — every status change and field edit is captured
- Scope 1/2/3 assignment is deterministic from source type + category

## Documentation

- [MODEL.md](docs/MODEL.md) — Data model and design decisions
- [DECISIONS.md](docs/DECISIONS.md) — Every ambiguity resolved
- [TRADEOFFS.md](docs/TRADEOFFS.md) — What was deliberately not built
- [SOURCES.md](docs/SOURCES.md) — Source format research for SAP, utility, and travel data

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/token/` | Get JWT tokens |
| POST | `/api/upload/{sap\|utility\|travel}/` | Upload CSV file |
| GET | `/api/records/` | List records with filters |
| GET/PATCH | `/api/records/{id}/` | Record detail + review actions |
| POST | `/api/records/bulk-action/` | Bulk approve/reject/flag |
| GET | `/api/batches/` | List ingestion batches |
| GET | `/api/summary/` | Scope totals + status counts |
| GET | `/api/clients/` | List clients |

## Emission Factor Sources

- **SAP fuel**: DEFRA 2024 GHG Conversion Factors (UK Government)
- **Utility electricity**: DESNZ 2024 UK grid intensity factors (national + regional)
- **Flights**: DEFRA 2024 aviation factors (includes RFI 1.891 multiplier)
- **Hotels**: HCMI 2023 regional averages
- **Ground transport**: DEFRA 2024 road transport factors
