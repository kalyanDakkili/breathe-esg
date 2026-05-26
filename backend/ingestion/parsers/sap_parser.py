"""
SAP Fuel & Procurement Parser

Format chosen: SAP flat-file IDOC/MBGMCR (Material Document) format as CSV export.
Justification in SOURCES.md — SAP BAPI MB_CREATE_GOODS_MOVEMENT generates flat exports
that most SAP BASIS teams can produce without custom development. The IDoc XML approach
exists but requires EDI middleware. The OData service (S/4HANA only) is too deployment-specific.
Flat CSV is the lowest-common-denominator that works across SAP ECC and S/4HANA.

Real SAP quirks handled here:
- WERKS field = plant code (needs lookup table)
- BUDAT = posting date (YYYYMMDD, no separators — German SAP standard)
- MENGE = quantity, MEINS = unit of measure
- German unit codes: L=Liters, KG=Kilograms, ST=Stück (pieces), M3=cubic meters
- MATNR = material number (18-char padded with leading zeros)
- BWART = movement type (101=goods receipt, 201=goods issue/consumption, 261=production withdrawal)
"""

import csv
import io
import decimal
from datetime import datetime, date
from typing import Optional

FUEL_MATERIAL_PREFIXES = {
    '100': 'diesel',
    '101': 'petrol',
    '102': 'natural_gas',
    '103': 'lpg',
    '200': 'procurement',  # general procurement (Scope 3)
}

# SAP German unit codes → canonical unit
UNIT_MAP = {
    'L': 'liters',
    'LT': 'liters',
    'M3': 'm3',
    'KG': 'kg',
    'T': 'tonnes',
    'KWH': 'kwh',
    'MWH': 'mwh',
    'ST': 'units',
    'GAL': 'gallons_us',
}

# Emission factors kg CO2e per liter / kg (DEFRA 2024 approximations)
FUEL_EMISSION_FACTORS = {
    'diesel': {'factor': 2.6391, 'unit': 'liters', 'kwh_per_liter': 10.7},
    'petrol': {'factor': 2.3132, 'unit': 'liters', 'kwh_per_liter': 9.5},
    'natural_gas': {'factor': 2.0425, 'unit': 'kg', 'kwh_per_kg': 13.1},
    'lpg': {'factor': 1.5559, 'unit': 'liters', 'kwh_per_liter': 7.1},
}

VALID_MOVEMENT_TYPES = {'201', '261', '262'}  # consumption/goods issue


def parse_date_sap(value: str) -> Optional[date]:
    """SAP dates come as YYYYMMDD with no separators."""
    value = value.strip()
    for fmt in ('%Y%m%d', '%d.%m.%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def normalize_material_number(matnr: str) -> str:
    """SAP pads material numbers with leading zeros to 18 chars."""
    return matnr.strip().lstrip('0') or '0'


def detect_fuel_type(matnr: str) -> str:
    clean = normalize_material_number(matnr)
    for prefix, fuel in FUEL_MATERIAL_PREFIXES.items():
        if clean.startswith(prefix):
            return fuel
    return 'unknown'


def convert_to_liters(quantity: decimal.Decimal, unit: str) -> Optional[decimal.Decimal]:
    if unit == 'liters':
        return quantity
    if unit == 'gallons_us':
        return quantity * decimal.Decimal('3.78541')
    if unit == 'm3':
        return quantity * decimal.Decimal('1000')
    return None


def parse_sap_batch(file_content: bytes, batch, client):
    """
    Parse SAP flat-file CSV export.
    Returns (records_created, parse_errors)
    """
    from emissions.models import EmissionRecord, RawRow, PlantCodeLookup

    text = file_content.decode('utf-8', errors='replace')
    reader = csv.DictReader(io.StringIO(text))

    records_created = []
    parse_errors = []
    row_index = 0

    # Build plant code lookup for this client
    plant_lookup = {
        p.sap_code: p for p in PlantCodeLookup.objects.filter(client=client)
    }

    for row in reader:
        raw_row = RawRow.objects.create(
            batch=batch,
            row_index=row_index,
            raw_data=dict(row),
        )

        try:
            movement_type = row.get('BWART', '').strip()
            if movement_type and movement_type not in VALID_MOVEMENT_TYPES:
                raw_row.parse_error = f"Movement type {movement_type} is not a consumption record — skipping"
                raw_row.save()
                row_index += 1
                continue

            posting_date = parse_date_sap(row.get('BUDAT', '') or row.get('posting_date', ''))
            if not posting_date:
                raise ValueError(f"Cannot parse date: {row.get('BUDAT', '')!r}")

            plant_code = row.get('WERKS', '').strip()
            plant = plant_lookup.get(plant_code)
            location = plant.location_name if plant else f"Plant {plant_code}"

            matnr = row.get('MATNR', '').strip()
            fuel_type = detect_fuel_type(matnr)
            category = 'fuel' if fuel_type != 'procurement' else 'procurement'
            scope = 1 if category == 'fuel' else 3

            raw_qty_str = row.get('MENGE', '0').strip().replace(',', '.')
            source_qty = decimal.Decimal(raw_qty_str)
            sap_unit = row.get('MEINS', 'L').strip().upper()
            source_unit = UNIT_MAP.get(sap_unit, sap_unit.lower())

            flags = []
            qty_liters = None
            kwh = None
            kg_co2e = None
            ef = None
            ef_source = ''

            if category == 'fuel' and fuel_type in FUEL_EMISSION_FACTORS:
                ef_data = FUEL_EMISSION_FACTORS[fuel_type]
                qty_liters = convert_to_liters(source_qty, source_unit)
                if qty_liters is not None:
                    ef = decimal.Decimal(str(ef_data['factor']))
                    kwh = qty_liters * decimal.Decimal(str(ef_data.get('kwh_per_liter', 0)))
                    kg_co2e = qty_liters * ef
                    ef_source = 'DEFRA 2024 GHG Conversion Factors'
                else:
                    flags.append(f"Cannot convert {source_unit} to liters for fuel {fuel_type}")
            else:
                flags.append(f"No emission factor for material {matnr} ({fuel_type})")

            if source_qty <= 0:
                flags.append("Zero or negative quantity — check source data")
            if source_qty > 100000:
                flags.append("Unusually large quantity — may be bulk/aggregate row")

            flag_reason = '; '.join(flags)
            status = 'flagged' if flags else 'pending'

            record = EmissionRecord.objects.create(
                client=client,
                batch=batch,
                raw_row=raw_row,
                scope=scope,
                category=category,
                status=status,
                activity_date=posting_date,
                location=location,
                sap_plant_code=plant_code,
                source_quantity=source_qty,
                source_unit=source_unit,
                quantity_kwh=kwh,
                emission_factor=ef,
                emission_factor_source=ef_source,
                quantity_kg_co2e=kg_co2e,
                fuel_type=fuel_type,
                source_material_code=normalize_material_number(matnr),
                source_vendor=row.get('LIFNR', '').strip(),
                flag_reason=flag_reason,
            )
            records_created.append(record)

        except Exception as e:
            raw_row.parse_error = str(e)
            raw_row.save()
            parse_errors.append({'row': row_index, 'error': str(e)})

        row_index += 1

    return records_created, parse_errors
