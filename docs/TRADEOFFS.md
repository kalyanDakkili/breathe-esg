# TRADEOFFS

Three things I deliberately did not build and why.

---

## 1. Re-calculation on emission factor update

**What it would be**: A management command or API endpoint that, when DEFRA publishes updated annual GHG conversion factors, re-computes `quantity_kg_co2e` for all `EmissionRecord` rows that used the old factors, creates new `AuditLog` entries noting the factor version change, and puts the re-calculated records back into `pending` status for re-approval.

**Why I didn't build it**: The data model is designed to support this — `quantity_kwh` and `distance_km` are stored separately from `quantity_kg_co2e`, and `emission_factor_source` is a citable string. The re-calculation logic itself would be a ~50-line management command. But the UX around it — notifying analysts, bulk re-approval flow, version tagging — would require another half-day of work and is not part of the core ingestion + review loop that was asked for.

**Cost of not having it now**: Analysts need to manually re-enter or re-upload affected records when factors change. Acceptable for a prototype, not for production.

---

## 2. Role-based access control beyond IsAuthenticated

**What it would be**: Two roles: `Analyst` (can upload, review, approve single records) and `Manager` (can bulk-approve, override locked records, add users, manage client access). A third `Auditor` role with read-only access to approved records and their audit logs, with no ability to see pending/rejected records.

**Why I didn't build it**: DRF's permission system makes this straightforward — a `HasRole` permission class checking a `UserProfile.role` field. But the assignment specified "analysts review and sign off" without mentioning multiple permission levels, and building a role management UI would have consumed time better spent on the core data model and parser quality. Using `is_staff` as a proxy for the manager role is a known shortcut.

**Cost of not having it now**: Any authenticated user can approve or reject any record. In a real deployment with client-facing analysts, this is a serious gap. An auditor who browses to `/api/records/?client_slug=X` can see unapproved data they shouldn't.

---

## 3. Scope 3 Category 1 — spend-based procurement emissions

**What it would be**: For SAP procurement records (goods receipts from external vendors), calculate Scope 3 Category 1 emissions using a spend-based methodology: `kg CO2e = spend_amount × emission_factor_per_currency_unit`, where the factor comes from a database like Exiobase or USEEIO, looked up by NACE/ISIC industry classification of the vendor.

**Why I didn't build it**: This requires three things I don't have in this prototype:
1. **Spend data from SAP**: The material document export I chose has quantities and material codes, not invoice amounts. A different SAP export (FI accounting documents, transaction FB50/MIRO) would be needed.
2. **Vendor-to-industry mapping**: A lookup table mapping vendor IDs to NACE codes. This data doesn't exist without client input.
3. **An EF database**: Exiobase is a 400GB MRIO model. A simplified coefficient table is available but requires careful version-matching with the reporting year.

The model is ready for this: `EmissionRecord.category = 'procurement'`, `source_vendor`, and `source_material_code` are stored. The parser flags procurement rows with "No emission factor for this category" rather than silently dropping them or guessing. A future sprint could wire up the spend-based calculation.

**Cost of not having it now**: Scope 3 Category 1 is typically the largest emission source for manufacturing companies. The prototype materially underreports the client's Scope 3 footprint. Analysts should know this when reviewing the totals.
