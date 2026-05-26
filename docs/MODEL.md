# DATA MODEL

## Overview

The data model is built around four concerns:
1. **Multi-tenancy** — every data row belongs to a `Client`, never shared
2. **Source-of-truth preservation** — raw source data is never mutated
3. **Audit trail** — every state change is logged immutably
4. **Unit normalization** — all quantities resolved to canonical units before CO2e calculation

---

## Entity Relationship

```
Client
  ├── PlantCodeLookup (SAP plant code → location mapping)
  ├── SourceBatch (one per file upload)
  │     └── RawRow (verbatim copy of each source row)
  │           └── EmissionRecord (normalized, calculated row)
  │                 └── AuditLog (immutable change history)
  └── EmissionRecord (FK for fast client-scoped queries)
```

---

## Models

### Client

Multi-tenancy root. Every queryset in the system is gated by `client_id`.

```
id (UUID PK)
name
slug (unique — used in API params)
country (ISO 3166-1 alpha-2)
created_at
```

**Design decision**: UUIDs for all PKs. Avoids sequential ID enumeration, which matters when batch and record IDs appear in API responses that clients might log.

In production, a middleware layer would inject `client_id` automatically from the authenticated user's profile, preventing cross-tenant data leakage even if an analyst passes the wrong `client_slug`.

---

### PlantCodeLookup

SAP plant codes (WERKS field) are arbitrary 4-digit internal identifiers that mean nothing without a per-client lookup table. This model holds that mapping.

```
client (FK → Client)
sap_code (e.g. "1001")
location_name (e.g. "Birmingham Plant")
country (ISO 3166-1)
region
```

**Unique constraint**: `(client, sap_code)`. Two clients can reuse the same SAP plant code space; they're not globally unique.

---

### SourceBatch

One row per ingestion job. This is the audit trail anchor.

```
id (UUID PK)
client (FK)
source_type: sap | utility | travel
uploaded_by (FK → User)
uploaded_at
filename
status: pending | processing | done | failed
rows_total / rows_parsed / rows_failed / rows_flagged
error_summary (JSON of first 20 parse errors)
raw_file (stored for re-processing)
```

**Why store the raw file?** If emission factors change (DEFRA updates annually) or a parsing bug is found, we need to re-derive `EmissionRecord` rows from scratch. The raw file is the anchor for that re-processing.

---

### RawRow

Verbatim copy of each row from the source file. **Never mutated after insert.**

```
batch (FK)
row_index (0-based position in file)
raw_data (JSONField — keys preserved as-is from source, including German SAP headers)
parse_error (non-empty if this row failed parsing)
created_at
```

**Why preserve the raw row?** Three reasons:
1. If an analyst disputes an `EmissionRecord` value, we can show them the exact source cell
2. If parsing logic changes, we can re-derive without re-uploading
3. Auditors sometimes ask "what exactly did the client send?" — this answers that

**Unique constraint**: `(batch, row_index)`. One raw row per position per batch.

---

### EmissionRecord

The normalized, reviewable, audit-lockable row. This is what analysts see.

#### Classification fields
```
scope: 1 | 2 | 3 (GHG Protocol scope)
category: fuel | procurement | electricity | flight | hotel | ground_transport
status: pending | approved | rejected | flagged
```

**Scope assignment logic:**
- Scope 1: Direct combustion — SAP fuel data (diesel, petrol, gas consumed at owned/controlled facilities)
- Scope 2: Purchased electricity — utility data
- Scope 3: Business travel — flights, hotels, ground transport; also procurement from SAP

#### Temporal fields
```
activity_date (normalized single date — midpoint for billing-period data)
period_start / period_end (null except for utility data where billing periods matter)
```

**Why two date representations?** Utility billing periods don't align with calendar months. A billing period from Oct 3 to Nov 2 should not be split across months without deliberate aggregation logic. Storing both lets the aggregation layer decide.

#### Unit normalization
All source quantities are preserved as-is in `source_quantity` + `source_unit`. Canonical representations are derived:

```
source_quantity    (original — e.g. 2840)
source_unit        (original — e.g. "liters", "kWh", "gallons_us")
quantity_kwh       (energy in kWh — for fuel and electricity)
distance_km        (for travel records)
emission_factor    (kg CO2e per unit — from DEFRA 2024 / DESNZ 2024 / HCMI 2023)
emission_factor_source  (citable reference string)
quantity_kg_co2e   (final output — kg CO2e)
```

**Why not just store kg CO2e?** Emission factors are updated annually. If DEFRA publishes revised 2025 factors, we need to re-calculate `quantity_kg_co2e` without asking clients to re-upload. Storing the underlying energy/distance quantities makes bulk re-calculation possible.

#### Provenance fields
```
sap_plant_code
fuel_type
utility_meter_id
travel_origin / travel_destination (IATA codes)
travel_class
source_vendor / source_material_code
```

These are source-specific. Null for irrelevant records (no `travel_origin` on a fuel record).

#### Quality control
```
flag_reason (auto-generated by parser — human-readable)
was_edited (True if analyst changed any field post-ingestion)
```

#### Review trail
```
reviewed_by (FK → User)
reviewed_at
review_note
```

**Approved records are logically locked.** In this prototype, approved records can be re-flagged or rejected (to handle mistakes). In production, "approved" would trigger a separate locked state that requires admin override with mandatory audit log entry.

---

### AuditLog

Immutable record of every state change. **Never edited or deleted.**

```
id (UUID PK)
record (FK → EmissionRecord)
action: created | approved | rejected | flagged | edited
performed_by (FK → User)
timestamp (auto)
field_changed (for edited action)
old_value / new_value
note
```

Every status change and field edit creates a new `AuditLog` entry. The audit log is append-only — there is no update or delete path through the API.

---

## Indexes

```sql
INDEX (client, status)    -- dashboard filter: "show me all flagged records for client X"
INDEX (client, scope)     -- scope breakdown queries
INDEX (batch)             -- "all records from this upload"
INDEX (activity_date)     -- time-series aggregation
```

---

## Multi-tenancy enforcement

In this prototype: `client_slug` is passed as a query parameter and validated against the DB.

In production: the authenticated user would have a `client_id` on their profile (or a set of `client_id` permissions for consultants who manage multiple clients). A custom DRF permission class and queryset mixin would inject the client filter automatically, making it impossible for an authenticated user to query another client's data even by guessing the `client_slug`.

---

## What this model does NOT handle (intentional scope limits)

See TRADEOFFS.md for full justification. In brief:
- **Market-based vs location-based Scope 2**: stored EF is location-based. Market-based requires contract data.
- **Scope 3 categories beyond travel**: categories 1–15 per GHG Protocol are not modeled here.
- **Currency / spend-based emission factors**: procurement records flag but don't calculate.
- **Version history of EmissionRecords**: `AuditLog` captures field-level changes but does not create full record snapshots.
