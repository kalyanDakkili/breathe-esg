"""Seeds demo data for Breathe ESG prototype."""
import decimal
from datetime import date
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from emissions.models import Client, PlantCodeLookup, SourceBatch, RawRow, EmissionRecord


class Command(BaseCommand):
    help = 'Seed demo data'

    def handle(self, *args, **options):
        user, _ = User.objects.get_or_create(username='analyst', defaults={
            'email': 'analyst@breatheesg.com', 'is_staff': True
        })
        user.set_password('demo1234')
        user.save()

        client, _ = Client.objects.get_or_create(
            slug='acme-corp',
            defaults={'name': 'Acme Manufacturing Ltd', 'country': 'GB'}
        )

        plants = [
            ('1001', 'Birmingham Plant', 'GB', 'West Midlands'),
            ('1002', 'Manchester Warehouse', 'GB', 'North West'),
            ('1003', 'Glasgow Distribution', 'GB', 'Scotland'),
            ('2001', 'Dublin Office', 'IE', 'Leinster'),
        ]
        for code, name, country, region in plants:
            PlantCodeLookup.objects.get_or_create(
                client=client, sap_code=code,
                defaults={'location_name': name, 'country': country, 'region': region}
            )

        sap_batch = SourceBatch.objects.create(
            client=client, source_type='sap', uploaded_by=user,
            filename='SAP_MIGO_Export_Q4_2024.csv', status='done',
            rows_total=7, rows_parsed=6, rows_failed=1, rows_flagged=2
        )

        sap_data = [
            (date(2024,10,3),  '1001','diesel',    2840, decimal.Decimal('7495.72'), '', 'pending'),
            (date(2024,10,15), '1002','diesel',    1220, decimal.Decimal('3219.69'), '', 'pending'),
            (date(2024,11,2),  '1001','petrol',     430, decimal.Decimal('994.68'),  '', 'pending'),
            (date(2024,11,18), '1003','diesel',     950, decimal.Decimal('2507.15'), '', 'pending'),
            (date(2024,12,5),  '1001','diesel',    3100, decimal.Decimal('8181.21'), 'Unusually large quantity — may be bulk/aggregate row', 'flagged'),
            (date(2024,12,20), '2001','natural_gas', 410, decimal.Decimal('837.43'), '', 'pending'),
            (date(2024,10,28), '1002','diesel',       0, None, 'Zero or negative quantity — check source data', 'flagged'),
        ]
        for i, (d, plant, fuel, qty, co2e, flag, st) in enumerate(sap_data):
            plant_obj = PlantCodeLookup.objects.filter(client=client, sap_code=plant).first()
            raw = RawRow.objects.create(batch=sap_batch, row_index=i,
                raw_data={'BUDAT': d.strftime('%Y%m%d'), 'WERKS': plant,
                          'MENGE': str(qty), 'MEINS': 'L', 'MATNR': '000000000010000001', 'BWART': '201'})
            EmissionRecord.objects.create(
                client=client, batch=sap_batch, raw_row=raw, scope=1, category='fuel', status=st,
                activity_date=d, location=plant_obj.location_name if plant_obj else plant,
                sap_plant_code=plant, source_quantity=decimal.Decimal(str(qty)), source_unit='liters',
                fuel_type=fuel, quantity_kwh=decimal.Decimal(str(qty))*decimal.Decimal('10.7') if qty else None,
                emission_factor=decimal.Decimal('2.6391'),
                emission_factor_source='DEFRA 2024 GHG Conversion Factors',
                quantity_kg_co2e=co2e, flag_reason=flag,
            )

        util_batch = SourceBatch.objects.create(
            client=client, source_type='utility', uploaded_by=user,
            filename='EDF_Portal_Export_Oct-Dec2024.csv', status='done',
            rows_total=8, rows_parsed=8, rows_failed=0, rows_flagged=2
        )
        util_data = [
            (date(2024,10,1), date(2024,10,31), 'Birmingham Plant', 'M001', 48320, decimal.Decimal('9900.46'), '', 'pending'),
            (date(2024,11,1), date(2024,11,30), 'Birmingham Plant', 'M001', 51200, decimal.Decimal('10492.22'), 'Estimated reading — confirm with actual meter read before approval', 'flagged'),
            (date(2024,12,1), date(2024,12,31), 'Birmingham Plant', 'M001', 55100, decimal.Decimal('11291.42'), '', 'pending'),
            (date(2024,10,1), date(2024,10,31), 'Manchester Warehouse', 'M002', 29400, decimal.Decimal('6024.94'), '', 'pending'),
            (date(2024,11,1), date(2024,11,30), 'Manchester Warehouse', 'M002', 31200, decimal.Decimal('6393.82'), '', 'approved'),
            (date(2024,12,1), date(2024,12,31), 'Manchester Warehouse', 'M002', 33800, decimal.Decimal('6926.57'), '', 'approved'),
            (date(2024,10,1), date(2024,12,31), 'Glasgow Distribution', 'M003', 22100, decimal.Decimal('3359.20'), 'Billing period is 91 days — unusually long, may be two invoices merged', 'flagged'),
            (date(2024,10,1), date(2024,10,31), 'Dublin Office', 'M004', 8400, decimal.Decimal('1722.72'), '', 'pending'),
        ]
        for i, (ps, pe, site, meter, kwh, co2e, flag, st) in enumerate(util_data):
            raw = RawRow.objects.create(batch=util_batch, row_index=i,
                raw_data={'BillingPeriodStart': ps.isoformat(), 'BillingPeriodEnd': pe.isoformat(),
                          'SiteReference': site, 'MeterSerialNumber': meter, 'ConsumptionKWh': str(kwh)})
            EmissionRecord.objects.create(
                client=client, batch=util_batch, raw_row=raw, scope=2, category='electricity', status=st,
                activity_date=ps, period_start=ps, period_end=pe, location=site, utility_meter_id=meter,
                source_quantity=decimal.Decimal(str(kwh)), source_unit='kwh', quantity_kwh=decimal.Decimal(str(kwh)),
                emission_factor=decimal.Decimal('0.20493'), emission_factor_source='DESNZ 2024 grid factor (UK)',
                quantity_kg_co2e=co2e, flag_reason=flag,
            )

        travel_batch = SourceBatch.objects.create(
            client=client, source_type='travel', uploaded_by=user,
            filename='Concur_Travel_Extract_Q4_2024.csv', status='done',
            rows_total=10, rows_parsed=10, rows_failed=0, rows_flagged=3
        )
        travel_data = [
            (date(2024,10,8),  'flight','E001','LHR','JFK','economy',        decimal.Decimal('5541'),decimal.Decimal('0.19085'),decimal.Decimal('1057.61'),'','pending'),
            (date(2024,10,22), 'flight','E002','BHX','AMS','economy',        decimal.Decimal('690'), decimal.Decimal('0.15553'),decimal.Decimal('107.32'), '','pending'),
            (date(2024,11,5),  'flight','E003','LHR','DXB','business',       decimal.Decimal('5480'),decimal.Decimal('0.57255'),decimal.Decimal('3137.57'),'','flagged'),
            (date(2024,11,14), 'flight','E001','MAN','CDG','economy',        decimal.Decimal('1060'),decimal.Decimal('0.15553'),decimal.Decimal('164.86'), '','pending'),
            (date(2024,12,3),  'flight','E004','LHR','BOM','economy',        decimal.Decimal('7180'),decimal.Decimal('0.19085'),decimal.Decimal('1370.30'),'Distance estimated via great-circle — verify','flagged'),
            (date(2024,10,8),  'hotel', 'E001','',  '',  '',                 decimal.Decimal('3'),   decimal.Decimal('15.2'),  decimal.Decimal('45.60'),  '','pending'),
            (date(2024,11,5),  'hotel', 'E003','',  '',  '',                 decimal.Decimal('2'),   decimal.Decimal('17.5'),  decimal.Decimal('35.00'),  '','pending'),
            (date(2024,10,7),  'ground_transport','E001','','','',            decimal.Decimal('42'),  decimal.Decimal('0.14868'),decimal.Decimal('6.24'),   '','pending'),
            (date(2024,10,21), 'ground_transport','E002','','','',            decimal.Decimal('28'),  decimal.Decimal('0.14868'),decimal.Decimal('4.16'),   '','pending'),
            (date(2024,11,4),  'ground_transport','E003','','','',            decimal.Decimal('0'),   None,None,'No distance — emission not calculated','flagged'),
        ]
        for i, (d, cat, emp, orig, dest, cls, qty, ef, co2e, flag, st) in enumerate(travel_data):
            src_unit = 'km' if cat == 'flight' else ('room_nights' if cat == 'hotel' else 'km')
            raw = RawRow.objects.create(batch=travel_batch, row_index=i,
                raw_data={'TravelDate': d.isoformat(), 'ExpenseType': cat, 'EmployeeID': emp,
                          'Origin': orig, 'Destination': dest, 'Class': cls})
            EmissionRecord.objects.create(
                client=client, batch=travel_batch, raw_row=raw, scope=3, category=cat, status=st,
                activity_date=d, employee_id=emp,
                source_quantity=qty, source_unit=src_unit,
                distance_km=qty if cat in ('flight','ground_transport') else None,
                emission_factor=ef, emission_factor_source='DEFRA 2024 / HCMI 2023',
                quantity_kg_co2e=co2e,
                travel_origin=orig, travel_destination=dest, travel_class=cls, flag_reason=flag,
            )

        count = EmissionRecord.objects.filter(client=client).count()
        self.stdout.write(self.style.SUCCESS(
            f'\n✓ Demo seeded!\n  Login: analyst / demo1234\n  Records: {count}\n'
        ))
