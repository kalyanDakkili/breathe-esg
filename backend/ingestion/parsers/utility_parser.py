"""
Utility / Electricity Parser

Format chosen: Portal CSV export (e.g., from Engie, EDF, or Green Mountain Power portals).
Justification: Most facilities teams have portal access; PDF parsing is brittle and requires OCR;
utility APIs (Green Button, ESPI) exist but require utility-side setup and OAuth.
CSV is what a facilities manager can actually produce in 2 minutes.

Realistic CSV columns from UK utility portal exports:
- AccountNumber, SiteReference, MeterSerialNumber
- BillingPeriodStart, BillingPeriodEnd (not calendar months — billing cycles vary)
- ConsumptionKWh (sometimes split: Day/Night for Economy 7 tariffs)
- PeakDemandKW, PowerFactor
- Unit (always kWh but sometimes MWh from large industrial meters)
- GridRegion (important: UK grid emission factors vary by region/time)
- ReadingType: Actual vs Estimated — we flag estimates

Grid emission factors (kg CO2e per kWh) - DESNZ 2024:
UK national average: 0.20493
Scottish grid (hydro-heavy): ~0.15
These are residual market factors. Location-based vs market-based is a known complexity — we use location-based here.
"""

import csv
import io
import decimal
from datetime import datetime, date
from typing import Optional

GRID_EMISSION_FACTORS = {
    'UK': decimal.Decimal('0.20493'),
    'UK_SCOTLAND': decimal.Decimal('0.15200'),
    'UK_WALES': decimal.Decimal('0.20000'),
    'EU_GERMANY': decimal.Decimal('0.36570'),
    'EU_FRANCE': decimal.Decimal('0.05160'),
    'US_NATIONAL': decimal.Decimal('0.38600'),
    'IN_NATIONAL': decimal.Decimal('0.70800'),
    'DEFAULT': decimal.Decimal('0.23300'),
}


def parse_date_utility(value: str) -> Optional[date]:
    value = value.strip()
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%m/%d/%Y', '%d-%m-%Y', '%d %b %Y'):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_utility_batch(file_content: bytes, batch, client):
    """
    Parse utility portal CSV export.
    """
    from emissions.models import EmissionRecord, RawRow

    text = file_content.decode('utf-8', errors='replace')
    reader = csv.DictReader(io.StringIO(text))

    records_created = []
    parse_errors = []
    row_index = 0

    for row in reader:
        raw_row = RawRow.objects.create(
            batch=batch,
            row_index=row_index,
            raw_data=dict(row),
        )

        try:
            # Support multiple common column name variants
            def get(keys, default=''):
                for k in keys:
                    val = row.get(k, '')
                    if val and val.strip():
                        return val.strip()
                return default

            account = get(['AccountNumber', 'account_number', 'Account'])
            meter_id = get(['MeterSerialNumber', 'meter_id', 'MeterID', 'Meter'])
            site_ref = get(['SiteReference', 'site_ref', 'Site', 'SiteName'])

            period_start_str = get(['BillingPeriodStart', 'period_start', 'StartDate', 'From'])
            period_end_str = get(['BillingPeriodEnd', 'period_end', 'EndDate', 'To'])
            period_start = parse_date_utility(period_start_str)
            period_end = parse_date_utility(period_end_str)

            if not period_start:
                raise ValueError(f"Cannot parse period start: {period_start_str!r}")
            if not period_end:
                raise ValueError(f"Cannot parse period end: {period_end_str!r}")

            # Activity date = midpoint of billing period for simplicity
            activity_date = period_start

            kwh_str = get(['ConsumptionKWh', 'consumption_kwh', 'kWh', 'Energy_kWh', 'UsageKWh'])
            if not kwh_str:
                # Try MWh
                mwh_str = get(['ConsumptionMWh', 'MWh'])
                if mwh_str:
                    kwh_str = str(decimal.Decimal(mwh_str.replace(',', '')) * 1000)
                else:
                    raise ValueError("No consumption quantity found in row")

            source_qty = decimal.Decimal(kwh_str.replace(',', ''))
            source_unit_raw = get(['Unit', 'unit'], 'kWh').upper()
            source_unit = 'kwh' if 'KWH' in source_unit_raw else 'mwh'

            # Normalize to kWh
            kwh = source_qty if source_unit == 'kwh' else source_qty * 1000

            grid_region = get(['GridRegion', 'grid_region', 'Region', 'Country'], 'DEFAULT').upper().replace(' ', '_')
            ef = GRID_EMISSION_FACTORS.get(grid_region, GRID_EMISSION_FACTORS['DEFAULT'])
            kg_co2e = kwh * ef

            reading_type = get(['ReadingType', 'reading_type', 'EstimatedActual'], 'Actual')
            is_estimated = 'estim' in reading_type.lower()

            flags = []
            if is_estimated:
                flags.append("Estimated reading — confirm with actual meter read before approval")
            if kwh <= 0:
                flags.append("Zero or negative consumption")
            if kwh > 500000:
                flags.append("Consumption >500,000 kWh in one period — verify meter scale")
            # Billing period sanity: >90 days is unusual
            if period_end and period_start:
                days = (period_end - period_start).days
                if days > 95:
                    flags.append(f"Billing period is {days} days — unusually long, may be two invoices merged")
                if days < 20:
                    flags.append(f"Billing period is only {days} days — partial bill?")

            flag_reason = '; '.join(flags)
            status = 'flagged' if flags else 'pending'

            record = EmissionRecord.objects.create(
                client=client,
                batch=batch,
                raw_row=raw_row,
                scope=2,
                category='electricity',
                status=status,
                activity_date=activity_date,
                period_start=period_start,
                period_end=period_end,
                location=site_ref,
                utility_meter_id=meter_id,
                source_quantity=source_qty,
                source_unit=source_unit,
                quantity_kwh=kwh,
                emission_factor=ef,
                emission_factor_source=f'DESNZ 2024 grid factor ({grid_region})',
                quantity_kg_co2e=kg_co2e,
                flag_reason=flag_reason,
            )
            records_created.append(record)

        except Exception as e:
            raw_row.parse_error = str(e)
            raw_row.save()
            parse_errors.append({'row': row_index, 'error': str(e)})

        row_index += 1

    return records_created, parse_errors
