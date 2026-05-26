# SOURCES

For each of the three data sources: what I researched, what I learned, what my sample data looks like, and what would break in a real deployment.

---

## 1. SAP Fuel & Procurement

### What I researched

SAP tracks material movements through the MM (Materials Management) module. The core object is the **Material Document** — created whenever inventory moves (goods receipt, goods issue, transfer, etc.). 

Key transactions:
- **MIGO**: Goods movement — this is where fuel consumption is posted when a plant manager records diesel used from a tank
- **MB51**: Material document list — the reporting transaction that produces the flat-file export
- **MB52**: Warehouse stocks — this shows quantities but not movements; not useful for emissions

The relevant fields in a material document flat-file export:
- `MANDT`: Client (SAP system client — not our client — ignore this)
- `MBLNR`: Material document number
- `MJAHR`: Material document year
- `ZEILE`: Line item number
- `BUDAT`: Posting date — **format YYYYMMDD with no separators** — this is the most common parsing pitfall
- `BLDAT`: Document date (may differ from posting date)
- `WERKS`: Plant code — 4-character, arbitrary, client-specific
- `LGORT`: Storage location within plant
- `MATNR`: Material number — 18 characters, **padded with leading zeros** — must be left-stripped to get meaningful codes
- `MENGE`: Quantity
- `MEINS`: Unit of measure — **German codes**: L (liters), KG (kilograms), M3 (cubic meters), ST (Stück = pieces), T (tonnes)
- `BWART`: Movement type — 101=goods receipt, 201=goods issue to cost center, 261=goods issue to production order, 262=reversal of 261
- `KOSTL`: Cost center (if consumption is to a cost center)
- `LIFNR`: Vendor number (for goods receipts)

The SAP OData service (`/sap/opu/odata/sap/MM_MATDOC_PUBLISH_SRV`) exists and is RESTful, but requires S/4HANA 1909+ and BASIS configuration. Most ESG consultants I looked at reference the flat-file approach precisely because it works on any SAP version.

### What I learned

1. **German column headers are real**: SAP was originally German software. Older ECC systems often export headers in German by default (`Buchungsdatum` = posting date, `Mengeinheit` = unit of measure). A client on an older system without English language pack will send you `Buchungsdatum` not `BUDAT`.

2. **Plant codes are meaningless without context**: `WERKS = 1001` means nothing. The client's SAP admin has a T001W table mapping plant codes to company codes, addresses, and country codes. Without this mapping, we can't assign emissions to locations. Our `PlantCodeLookup` model handles this — the client would need to provide us with their T001W extract.

3. **The unit of measure for natural gas changes**: Gas can be measured in M3, kWh (thermal), therms, or kg. The conversion between M3 and kWh depends on the calorific value of the local gas supply, which varies by country and supplier. We handle M3→kWh via a standard UK conversion (1 m3 ≈ 10.55 kWh gross calorific value per DEFRA) — a real deployment would need the client's gas bills to confirm.

4. **Movement type reversals**: A movement type 262 (reversal of goods issue) should offset a prior 261. In this prototype we skip reversals. In production, reversals must be matched to their original document and the net quantity used.

### Sample data design

My sample SAP CSV uses:
- `BUDAT` in YYYYMMDD format (the most common real-world format)
- `WERKS` codes that map to real named locations via `PlantCodeLookup`
- `MATNR` codes where the prefix encodes the fuel type (100xxxxx = diesel, 101xxxxx = petrol, 102xxxxx = natural gas)
- `MEINS = L` (liters) for liquid fuels, `KG` for natural gas
- `BWART = 201` (goods issue to cost center) for all fuel consumption rows
- One row with quantity 0 to trigger the zero-quantity flag
- One row with a high quantity to trigger the large-quantity flag

Why this looks realistic: Real fuel consumption data for a mid-size UK manufacturer with 4 sites over a quarter would show 3-6 fuel postings per site per month, quantities in the thousands of liters per period for transport and heating. Our Q4 data (Oct-Dec) reflects higher heating fuel use typical of winter months in the UK.

### What would break in a real deployment

1. **German column headers**: Parser would fail to find `BUDAT` and fall back to `posting_date` — which doesn't exist either. Fix: header normalization map.
2. **Movement type reversals**: Reversal rows would be skipped rather than netting against their original. Fix: reversal-matching logic by document number.
3. **Gas in M3**: Calorific value varies. Our 10.55 kWh/m3 is UK national average. A continental European client using different gas would give wrong kWh values. Fix: configurable calorific value per client.
4. **Vendor GL coding for Scope 3**: Procured goods from external vendors need Scope 3 Category 1 treatment. We flag these but don't calculate. Fix: spend-based calculation module.
5. **Multi-currency**: SAP material documents include currency for valuation but we don't use it. Procurement emission factors are often per-currency-unit. Fix: currency normalization.

---

## 2. Utility / Electricity

### What I researched

Utility billing data in the UK can come from:
- **Portal CSV exports**: All major UK utilities (EDF, Octopus, British Gas, Engie, Eon) offer portal access where facilities managers can export consumption data as CSV. This is the most accessible format.
- **PDF bills**: Widely used but extremely difficult to parse reliably. Every utility has a different layout. Even within one utility, layouts change across tariff types (half-hourly metered, quarterly, Economy 7).
- **Green Button / ESPI**: The US standard (mandated for US utilities). UK equivalent is the Smart Meter Data API from the Data Communications Company (DCC), but access requires authorisation through the energy supplier and is not yet widely available.
- **Half-Hourly Data (HH)**: Large commercial/industrial sites with HH metering get consumption data at 30-minute intervals. This is highly accurate but produces large files (17,520 rows per meter per year).

The key complication in utility data: **billing periods do not align with calendar months**. A meter read on October 3rd and the next on November 4th produces a 32-day billing period. Time-series aggregation (e.g., "Q4 consumption") requires proration logic. Our model stores `period_start` and `period_end` explicitly for this reason.

Grid emission factors (DESNZ, published annually):
- UK national average (2024): 0.20493 kg CO2e/kWh
- This has fallen from ~0.49 in 2012 as renewable penetration increased
- Scotland has a lower factor (~0.152) due to hydro and wind
- The "residual mix" factor (for market-based Scope 2) is higher: ~0.27 in 2024

### What I learned

1. **Estimated vs actual reads**: UK utilities flag readings as "Actual" (meter read by engineer or smart meter) or "Estimated" (interpolated by billing system). Estimated reads should not be approved without confirmation — they're often wrong and get corrected in the next actual read.

2. **Billing period alignment is a real problem**: A facilities manager who exports Jan-Mar utility data will get billing periods that start in December and end in April. Year-end reporting requires proration. Our model stores raw billing periods and flags anomalous ones (>90 days, <20 days).

3. **Multiple meters per site**: A Birmingham plant might have 3 meters (main supply, data hall, canteen). The portal exports one row per meter per period. We aggregate by `SiteReference` in the UI but store per-meter in the database.

4. **Unit confusion: kWh vs MWh**: Small sites report in kWh; large industrial sites often report in MWh (and sometimes confusingly in kVAh or kVARh for reactive power — these are not energy units and shouldn't be used for emissions). Our parser handles kWh/MWh and flags anything else.

### Sample data design

My sample utility CSV uses:
- Three sites with different meter IDs
- October-December Q4 data with billing periods anchored to calendar months (most portal exports do align to calendar months if the contract started at month boundaries)
- Glasgow Distribution on a single 91-day billing period (common for smaller sites or rural properties on quarterly billing) — triggers the long-period flag
- One November row marked as "Estimated" — triggers the estimated reading flag
- Consumption values realistic for UK manufacturing: Birmingham plant at ~50,000 kWh/month is reasonable for a light manufacturing facility (~70kW average demand)

### What would break in a real deployment

1. **Estimated reads without subsequent actual**: If a client submits Q4 data where the December read is estimated, and the January actual hasn't been received yet, the Q4 total is provisional. We flag it but don't prevent approval. Fix: block approval of estimated reads pending confirmation.
2. **Multiple meters per site need aggregation**: We store per-meter records; the UI sums by site. If a meter is replaced mid-period, you get two records for the same site covering overlapping periods. Fix: meter history tracking.
3. **Economy 7 / time-of-use tariffs**: Some sites have separate Day and Night consumption columns. Our parser expects a single ConsumptionKWh column. Fix: add Day/Night variant parser that sums to total.
4. **PDF bills**: We don't parse PDFs. Any client that can only provide PDF utility bills would need manual data entry or a separate PDF extraction service. Fix: integrate a PDF parser with a utility bill template library.
5. **Transmission & distribution (T&D) losses**: Scope 2 also technically includes T&D losses (typically ~7% on top of consumed kWh). We don't model this. Fix: add T&D loss factor to utility records.

---

## 3. Corporate Travel

### What I researched

SAP Concur dominates enterprise T&E (~70% market share for large enterprises). Navan (formerly TripActions) is the main challenger in mid-market. Both expose data via:
- **Expense Report Export**: CSV of all expense line items from approved reports
- **Travel Booking Extract**: CSV of bookings from the travel booking engine (often more complete for flights)
- **API**: Both have REST APIs (Concur v4, Navan GraphQL) but they require OAuth setup and IT involvement

I looked at Concur's "Standard Accounting Extract" format, which is what most finance teams already pull for GL reconciliation. Relevant fields:
- `ExpenseType`: Free-text but typically one of: Air Travel, Hotel, Car Rental, Taxi/Uber, Rail, Meals (Meals = out of scope)
- `TravelDate` / `CheckInDate` / `DepartureDate`: Inconsistent naming depending on category
- `Origin` / `Destination`: IATA codes for flights; city names for hotels; often blank for ground
- `Class` / `CabinClass`: Economy, Business, First (often abbreviated: "ECO", "BUS", "FST")
- `DistanceKm` / `Miles`: Ground transport mileage claims (in the US, always miles; UK varies)
- `Amount`: Transaction amount in report currency — useful for spend-based methods but we use distance-based

Key emission factor sources:
- **DEFRA 2024 GHG Conversion Factors**: UK government publication, updated annually in June. Covers UK domestic flights, international flights by region, car, taxi, rail. Includes an RFI (Radiative Forcing Index) multiplier of 1.891 for flights, which accounts for non-CO2 warming effects (contrails, NOx) at altitude.
- **HCMI (Hotel Carbon Measurement Initiative)**: Industry standard for hotel carbon, provides per-room-night factors by hotel brand/property. We use regional averages as a fallback.
- **ICAO Carbon Emissions Calculator**: ICAO's own tool — we don't integrate with it, but it's the basis for many airline carbon calculators.

### What I learned

1. **Airport codes vs city names**: Concur sometimes gives IATA codes (LHR, JFK), sometimes ICAO codes (EGLL, KJFK), sometimes city names ("London Heathrow"), sometimes nothing. We handle IATA 3-letter codes and flag anything we can't resolve.

2. **Class of travel matters enormously**: DEFRA 2024 long-haul factors: economy = 0.191 kg CO2e/km, business = 0.573 kg CO2e/km (3× higher). A single long-haul business class flight can be 5× the annual emissions of a UK employee's commute. The class field in Concur is inconsistently populated — our parser normalizes it and defaults to economy if unreadable.

3. **The RFI debate**: The RFI of 1.891 is contested. Some accounting standards (GHG Protocol) recommend reporting with and without RFI. DEFRA's factors include RFI. We apply RFI consistently, which is conservative and makes our numbers higher than airline carbon calculators that often omit it.

4. **Hotel data is sparse**: Concur expense data for hotels has: hotel name, city, check-in/out, cost. It does not have room type, bed count, star rating, or energy data. HCMI methodology is the only practical approach without requesting hotel-specific data.

5. **Mileage claims are in miles in the US**: Concur defaults to miles for US-configured instances. UK instances may use km. We detect the unit from the column header and convert.

### Sample data design

My sample travel CSV includes:
- 4 flights: LHR→JFK (long-haul economy), BHX→AMS (short-haul), LHR→DXB (long-haul business — triggers "notable CO2e" in a real QA check), MAN→CDG (short-haul), LHR→BOM (long-haul — BOM not in our small airport table, triggers estimation flag)
- 2 hotel stays with room-nights
- 2 taxi journeys with distances
- 1 taxi journey with no distance — triggers the "emission not calculated" flag

The employees (E001, E002, E003, E004) are consistent across records to allow per-employee aggregation (useful for travel policy enforcement, not in scope for this prototype but the data supports it).

The LHR→DXB business class record is deliberately included because: (a) it generates the largest CO2e of any single record (~3.1 tonnes), (b) it will likely draw analyst attention, and (c) it tests whether the UI handles high-value outliers clearly.

### What would break in a real deployment

1. **Unrecognized airport codes**: Our IATA table covers ~30 major airports. Any other origin/destination would produce a null distance and uncalculated CO2e. Fix: integrate a full IATA airport database (8,000+ entries).
2. **Expense type normalization**: "AirTravel", "air_travel", "Air", "Airline" — all the same thing but different Concur configurations. Our parser uses `in`/string matching; a real deployment needs a configurable mapping table per client.
3. **Multi-leg flights**: A LHR→AMS→JFK itinerary might appear as one expense or two. Concur usually splits by leg, but some configurations don't. Fix: detect connecting itineraries and split.
4. **Personal car mileage**: Employees sometimes claim mileage for using personal cars. The emission factor for this should use the specific car type (if known) or DEFRA's average car factor. We'd need to distinguish "Taxi" from "Personal Car Mileage" — they look similar in expense data.
5. **Rental car data**: Concur rental car records include pick-up/drop-off locations but rarely distance. We'd need to calculate distance from itinerary dates and a rental car average daily mileage assumption.
