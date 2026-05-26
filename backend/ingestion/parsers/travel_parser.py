"""
Corporate Travel Parser

Format chosen: Concur Expense/Travel export CSV (SAP Concur is the dominant platform).
Also compatible with Navan (formerly TripActions) exports which use similar columns.
Justification: Concur has ~70% enterprise market share for T&E. Their standard export
("Expense Report Export" or "Travel Booking Extract") is a flat CSV that finance teams
already pull for expense reconciliation. We reuse the same file.

Key complexities handled:
1. Flights: airport codes given, not distances. We use a simplified great-circle lookup.
   Real deployment would use ICAO/OAG distance data or the DEFRA flight distance tool.
2. Hotels: no CO2 data from Concur. We use HCMI methodology: kgCO2e per room-night by star rating.
3. Ground transport: category-based (taxi, rental car, rail) × distance if available.
4. Class of travel: DEFRA 2024 has separate factors for economy/business/first.

Distance estimation: We hardcode a minimal set of major routes for demo.
Real deployment: integrate with airport distance API or maintain a route database.
"""

import csv
import io
import decimal
from datetime import datetime, date
from typing import Optional, Dict

# IATA → approx lat/lon for great-circle estimation
AIRPORT_COORDS = {
    'LHR': (51.477, -0.461), 'LGW': (51.148, -0.190), 'MAN': (53.353, -2.275),
    'BHX': (52.454, -1.748), 'EDI': (55.950, -3.372), 'GLA': (55.872, -4.433),
    'JFK': (40.640, -73.779), 'LAX': (33.943, -118.408), 'ORD': (41.974, -87.907),
    'SFO': (37.619, -122.375), 'BOS': (42.366, -71.010), 'MIA': (25.796, -80.287),
    'CDG': (49.010, 2.548), 'AMS': (52.310, 4.768), 'FRA': (50.037, 8.562),
    'MAD': (40.472, -3.561), 'BCN': (41.297, 2.078), 'FCO': (41.800, 12.239),
    'DXB': (25.253, 55.364), 'SIN': (1.359, 103.989), 'BOM': (19.089, 72.868),
    'DEL': (28.556, 77.100), 'BLR': (13.199, 77.706), 'HYD': (17.231, 78.430),
    'NRT': (35.765, 140.386), 'ICN': (37.460, 126.439), 'PEK': (40.080, 116.585),
    'SYD': (-33.946, 151.177), 'MEL': (-37.674, 144.843),
}

import math
def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))

def get_flight_distance_km(origin: str, dest: str) -> Optional[float]:
    o = AIRPORT_COORDS.get(origin.upper())
    d = AIRPORT_COORDS.get(dest.upper())
    if o and d:
        return haversine_km(o[0], o[1], d[0], d[1])
    return None

# DEFRA 2024 flight emission factors kg CO2e per km per passenger (includes RFI multiplier 1.891)
FLIGHT_FACTORS = {
    'economy':     {'short': decimal.Decimal('0.15553'), 'long': decimal.Decimal('0.19085')},
    'premium_economy': {'short': decimal.Decimal('0.23329'), 'long': decimal.Decimal('0.28627')},
    'business':    {'short': decimal.Decimal('0.23329'), 'long': decimal.Decimal('0.57255')},
    'first':       {'short': decimal.Decimal('0.62082'), 'long': decimal.Decimal('0.76283')},
}
SHORT_HAUL_THRESHOLD_KM = 3700

# HCMI hotel factors (kg CO2e per room night) by region
HOTEL_FACTORS = {
    'UK': decimal.Decimal('15.2'),
    'EU': decimal.Decimal('14.1'),
    'US': decimal.Decimal('23.8'),
    'IN': decimal.Decimal('18.4'),
    'DEFAULT': decimal.Decimal('17.5'),
}

# Ground transport factors kg CO2e per km
GROUND_FACTORS = {
    'taxi':       decimal.Decimal('0.14868'),
    'rental_car': decimal.Decimal('0.16844'),
    'rail':       decimal.Decimal('0.03549'),
    'bus':        decimal.Decimal('0.07866'),
    'default':    decimal.Decimal('0.14868'),
}


def parse_date_travel(value: str) -> Optional[date]:
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%m/%d/%Y', '%d-%b-%Y', '%b %d, %Y'):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except:
            pass
    return None


def parse_travel_batch(file_content: bytes, batch, client):
    from emissions.models import EmissionRecord, RawRow

    text = file_content.decode('utf-8', errors='replace')
    reader = csv.DictReader(io.StringIO(text))

    records_created = []
    parse_errors = []
    row_index = 0

    for row in reader:
        raw_row = RawRow.objects.create(batch=batch, row_index=row_index, raw_data=dict(row))

        try:
            def get(keys, default=''):
                for k in keys:
                    v = row.get(k, '')
                    if v and str(v).strip():
                        return str(v).strip()
                return default

            expense_type = get(['ExpenseType', 'expense_type', 'Category', 'Type']).lower()
            travel_date_str = get(['TravelDate', 'travel_date', 'Date', 'DepartureDate', 'CheckInDate'])
            travel_date = parse_date_travel(travel_date_str)
            if not travel_date:
                raise ValueError(f"Cannot parse date: {travel_date_str!r}")

            employee_id = get(['EmployeeID', 'employee_id', 'EmpID', 'UserID'])

            flags = []
            kg_co2e = None
            ef = None
            ef_source = ''
            distance_km = None
            category = 'ground_transport'
            scope = 3
            origin = ''
            destination = ''
            travel_class = ''

            if 'air' in expense_type or 'flight' in expense_type or 'airline' in expense_type:
                category = 'flight'
                origin = get(['Origin', 'origin', 'DepartureAirport', 'From']).upper()[:3]
                destination = get(['Destination', 'destination', 'ArrivalAirport', 'To']).upper()[:3]
                travel_class = get(['Class', 'cabin_class', 'CabinClass', 'ServiceClass'], 'economy').lower()
                if 'business' in travel_class:
                    travel_class = 'business'
                elif 'premium' in travel_class:
                    travel_class = 'premium_economy'
                elif 'first' in travel_class:
                    travel_class = 'first'
                else:
                    travel_class = 'economy'

                dist = get(['DistanceKm', 'distance_km', 'Distance'])
                if dist:
                    distance_km = decimal.Decimal(dist.replace(',', ''))
                elif origin and destination and len(origin) == 3 and len(destination) == 3:
                    d = get_flight_distance_km(origin, destination)
                    if d:
                        distance_km = decimal.Decimal(str(round(d, 2)))
                        flags.append(f"Distance estimated via great-circle ({origin}→{destination}): {distance_km:.0f}km — verify")
                    else:
                        flags.append(f"Unknown airport codes {origin}/{destination} — distance and CO2 not calculated")

                if distance_km:
                    haul = 'long' if distance_km > SHORT_HAUL_THRESHOLD_KM else 'short'
                    ef = FLIGHT_FACTORS.get(travel_class, FLIGHT_FACTORS['economy'])[haul]
                    kg_co2e = distance_km * ef
                    ef_source = f'DEFRA 2024 Aviation ({travel_class}, {haul}-haul, incl. RFI 1.891)'

                source_qty = distance_km or decimal.Decimal('0')
                source_unit = 'km'

            elif 'hotel' in expense_type or 'accommodation' in expense_type or 'lodging' in expense_type:
                category = 'hotel'
                nights_str = get(['Nights', 'nights', 'NightCount', 'Duration'], '1')
                source_qty = decimal.Decimal(nights_str)
                source_unit = 'room_nights'
                country = get(['Country', 'country', 'Destination'], 'DEFAULT').upper()[:2]
                region_key = 'UK' if country == 'GB' else ('US' if country == 'US' else ('IN' if country == 'IN' else 'DEFAULT'))
                ef = HOTEL_FACTORS.get(region_key, HOTEL_FACTORS['DEFAULT'])
                kg_co2e = source_qty * ef
                ef_source = f'HCMI 2023 hotel methodology ({region_key})'
                distance_km = None

            else:
                # Ground transport
                category = 'ground_transport'
                transport_subtype = 'taxi' if 'taxi' in expense_type or 'uber' in expense_type or 'lyft' in expense_type else \
                                    'rail' if 'train' in expense_type or 'rail' in expense_type else \
                                    'rental_car' if 'car' in expense_type or 'rental' in expense_type else 'default'
                dist_str = get(['DistanceKm', 'distance_km', 'Miles', 'Mileage'])
                if dist_str:
                    distance_km = decimal.Decimal(dist_str.replace(',', ''))
                    # Check if it's miles (Concur US defaults to miles)
                    unit_raw = get(['DistanceUnit', 'unit'], 'km').lower()
                    if 'mile' in unit_raw:
                        distance_km = distance_km * decimal.Decimal('1.60934')
                        flags.append("Distance converted from miles to km")
                    source_qty = distance_km
                    source_unit = 'km'
                    ef = GROUND_FACTORS.get(transport_subtype, GROUND_FACTORS['default'])
                    kg_co2e = distance_km * ef
                    ef_source = f'DEFRA 2024 ({transport_subtype})'
                else:
                    amount_str = get(['Amount', 'amount', 'Cost'])
                    source_qty = decimal.Decimal(amount_str or '0')
                    source_unit = 'currency'
                    flags.append("No distance for ground transport — emission cannot be calculated without distance")
                    ef = None
                    kg_co2e = None

            if kg_co2e is None or kg_co2e == 0:
                flags.append("CO2e not calculated — manual review required")

            flag_reason = '; '.join(flags)
            status = 'flagged' if flags else 'pending'

            record = EmissionRecord.objects.create(
                client=client,
                batch=batch,
                raw_row=raw_row,
                scope=3,
                category=category,
                status=status,
                activity_date=travel_date,
                employee_id=employee_id,
                source_quantity=source_qty if 'source_qty' in dir() else decimal.Decimal('0'),
                source_unit=source_unit if 'source_unit' in dir() else 'unknown',
                distance_km=distance_km,
                emission_factor=ef,
                emission_factor_source=ef_source,
                quantity_kg_co2e=kg_co2e,
                travel_origin=origin,
                travel_destination=destination,
                travel_class=travel_class,
                flag_reason=flag_reason,
            )
            records_created.append(record)

        except Exception as e:
            raw_row.parse_error = str(e)
            raw_row.save()
            parse_errors.append({'row': row_index, 'error': str(e)})

        row_index += 1

    return records_created, parse_errors
