# Breathe ESG — Emissions Ingestion Platform

A Django + React prototype for ingesting, normalizing, and reviewing emissions data from SAP, utility portals, and corporate travel platforms.

## Live Demo

**App**: https://breathe-esg-taupe.vercel.app  
**Login**: `analyst` / `demo1234`

> **Note on cold starts**: The backend is hosted on Render's free tier. If the app shows a loading delay on first visit (up to 60 seconds), this is expected — Render spins down free services after inactivity. Subsequent requests are fast. In production this would run on a paid instance with zero cold start.

## Deployment

| Layer | Platform | URL |
|-------|----------|-----|
| Frontend | Vercel | https://breathe-esg-taupe.vercel.app |
| Backend API | Render (free tier) | https://breathe-esg-backend-ttlw.onrender.com |

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
npm run dev
```

Open `http://localhost:5173` — login: `analyst` / `demo1234`

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

## Known Limitations (Free Tier)

### Render free tier constraints
- **Cold starts**: Service spins down after 15 minutes of inactivity. First request after inactivity takes 30-60 seconds to wake up. This is a Render free tier limitation, not an application issue.
- **SQLite resets on redeploy**: Every redeploy resets the database and re-runs `seed_demo`. In production this would use PostgreSQL (Render provides managed Postgres).
- **Ephemeral storage**: Uploaded files are lost on redeploy since free tier has no persistent disk. Production would use S3 or similar object storage.
- **Single worker**: Free tier runs one gunicorn worker. Concurrent requests queue. Production would run 2-4 workers minimum.

### What would change in production
- PostgreSQL instead of SQLite
- S3 for raw file storage
- Paid Render instance (no cold starts, persistent disk)
- Proper secret management via environment vault
- Role-based access control (Analyst / Manager / Auditor)
- Two-person approval workflow before audit lock
