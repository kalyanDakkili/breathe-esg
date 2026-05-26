# DECISIONS

Every ambiguity I encountered, what I chose, why, and what I'd ask the PM.

---

## SAP ingestion format

**Ambiguity**: SAP exposes data in many ways — IDoc XML, OData v4 (S/4HANA only), BAPI calls via RFC, flat-file export from MB51/MIGO.

**Choice**: Flat-file CSV export from transaction MB51 (material document list) or MIGO.

**Why**: Flat-file export is the lowest common denominator that works on both SAP ECC (still the majority of large enterprise deployments) and S/4HANA. IDoc requires EDI middleware configuration. OData requires S/4HANA and BASIS setup. BAPIs require ABAP developer involvement. The flat-file export is something a sustainability manager can ask the SAP basis team to run in 10 minutes with no custom development.

**What I'd ask the PM**: "Does this client have S/4HANA or ECC? Do they have an API-first integration team or are we working with the sustainability lead who has portal access?" The answer would change the format.

---

## SAP movement type filtering

**Ambiguity**: SAP material documents include receipts (101), returns (102), goods issues (201, 261), reversals (262), etc.

**Choice**: Only process movement types 201 and 261 (consumption/goods issue to cost center and production order). Skip 262 (reversal) and 101 (receipt).

**Why**: We want actual consumption events, not inventory movements. A 101 goods receipt means fuel arrived; the 201 when it's consumed is the actual emission event. Reversals should cancel a prior emission record — this prototype flags the reversal row as a parse error rather than attempting reversal matching, which is complex.

**What I'd ask the PM**: "Should we model reversals? If plant 1001 issued 2000L of diesel and then reversed 500L, should we show 1500L net or two separate records?"

---

## Utility data format

**Ambiguity**: "Utility portals" — Green Button (ESPI API standard), PDF bills, portal CSV exports.

**Choice**: Portal CSV export.

**Why**: Green Button/ESPI requires utility-side OAuth setup and API access that many facilities teams don't have. PDF parsing requires OCR and is extremely brittle (every utility has a different bill layout). CSV export is what a facilities manager can produce from any UK utility portal (EDF, Octopus, British Gas) in under 2 minutes.

**What I'd ask the PM**: "Does this client have API access from their utilities? What's their facilities team's technical comfort level?"

---

## Utility grid emission factor: location-based vs market-based

**Ambiguity**: GHG Protocol Scope 2 Guidance allows two methods: location-based (average grid factor) and market-based (supplier-specific factor using REGOs/GOs).

**Choice**: Location-based only, using DESNZ 2024 national and regional factors.

**Why**: Market-based requires the client to have renewable energy certificates (REGOs in the UK, GOs in the EU) and the utility to provide attribute matching data. Most clients don't have this at ingestion time. We store which factor we used (`emission_factor_source`) so it can be recalculated if the client later provides market-based evidence.

**What I'd ask the PM**: "Does the client procure renewable electricity under contract or via REGOs? If so, we need their certificate data before we can do market-based Scope 2."

---

## Flight distance calculation

**Ambiguity**: Concur gives origin and destination airport codes. Sometimes it gives distance; usually it doesn't.

**Choice**: If distance is not in the data, calculate from IATA codes using a great-circle haversine formula with a hardcoded airport coordinate table. Flag the record to indicate the distance was estimated.

**Why**: ICAO/OAG distance databases are proprietary and expensive. For a prototype, great-circle distance is sufficient and well-understood. The flag ensures analysts know to validate before approval.

**Real deployment**: Integrate with a flight distance API (e.g. ICAO Carbon Emissions Calculator or OAG) or maintain a route database. Also: the DEFRA factor includes an RFI (Radiative Forcing Index) multiplier of 1.891 which accounts for non-CO2 warming effects at altitude — we apply this by default, which is conservative.

**What I'd ask the PM**: "Are analysts expected to validate estimated distances, or should we block approval on records without confirmed distances?"

---

## Hotel emission calculation

**Ambiguity**: Concur expense data for hotels typically includes: hotel name, city, check-in/out dates, total cost. It does not include kWh consumption.

**Choice**: HCMI (Hotel Carbon Measurement Initiative) methodology — a per-room-night factor by region. We use: UK £15.2/night, EU £14.1/night, US £23.8/night, Default £17.5/night.

**Why**: HCMI is the industry standard for hotel carbon. The factors are published and auditable. Alternatives (energy-intensity × star rating, or supplier-provided data) require data we don't have from Concur.

**Limitation**: HCMI factors are averages. A Travelodge and a 5-star hotel in the same city get the same factor. In a real deployment, we'd want to integrate with the HCMI database which has property-level factors for major hotel groups.

---

## Procurement (SAP Scope 3)

**Ambiguity**: SAP procurement data (goods receipts from suppliers) could represent Scope 3 Category 1 (purchased goods and services). But spend-based emission factors are complex and data-hungry.

**Choice**: Flag procurement records as Scope 3 / procurement category, calculate no CO2e, require manual input by analyst.

**Why**: Spend-based Scope 3 requires: the spend amount in a consistent currency, a mapping from material/supplier to an industry classification (NACE/ISIC code), and a spend-based EF database (e.g. Exiobase, USEEIO). This is a substantial additional project. The model supports it (category and source fields are there), but the parser doesn't calculate it.

---

## Approved record locking

**Ambiguity**: Once an analyst approves a record, should it be editable?

**Choice**: In this prototype, approved records can still be re-flagged or rejected by an analyst. The audit log captures every change. In production, "approved" would lock the record against any edit — only a supervisor with `is_staff=True` could override with a mandatory note.

**Why this tradeoff**: For demo purposes, strict locking makes testing cumbersome. The data model and audit log are designed to support proper locking — it's a permission check and UI disable away.

---

## What I'd prioritize next given more time

1. **Market-based Scope 2**: High value for clients with renewable energy contracts
2. **Scope 3 Category 1 (procurement)**: Spend-based factors via Exiobase
3. **Period alignment**: Automatically split billing periods that cross reporting year boundaries
4. **Automated re-calculation**: Bulk update `quantity_kg_co2e` when DEFRA releases annual factor updates
5. **Approval workflow**: Two-person rule (analyst approves, manager signs off) before audit lock
