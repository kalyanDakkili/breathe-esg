import json
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from emissions.models import Client, SourceBatch, EmissionRecord, RawRow, AuditLog
from .parsers.sap_parser import parse_sap_batch
from .parsers.utility_parser import parse_utility_batch
from .parsers.travel_parser import parse_travel_batch


class UploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, source_type):
        if source_type not in ('sap', 'utility', 'travel'):
            return Response({'error': 'Unknown source type'}, status=400)

        client_slug = request.data.get('client_slug') or request.query_params.get('client_slug')
        try:
            client = Client.objects.get(slug=client_slug)
        except Client.DoesNotExist:
            return Response({'error': f'Client {client_slug!r} not found'}, status=404)

        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response({'error': 'No file uploaded'}, status=400)

        # Read content BEFORE FileField saves (which advances the file pointer)
        file_content = uploaded_file.read()
        uploaded_file.seek(0)  # Reset for FileField storage

        batch = SourceBatch.objects.create(
            client=client,
            source_type=source_type,
            uploaded_by=request.user,
            filename=uploaded_file.name,
            status='processing',
            raw_file=uploaded_file,
        )

        try:
            parsers = {'sap': parse_sap_batch, 'utility': parse_utility_batch, 'travel': parse_travel_batch}
            records, errors = parsers[source_type](file_content, batch, client)

            batch.rows_total = batch.raw_rows.count()
            batch.rows_parsed = len(records)
            batch.rows_failed = len(errors)
            batch.rows_flagged = sum(1 for r in records if r.status == 'flagged')
            batch.status = 'done'
            batch.error_summary = json.dumps(errors[:20]) if errors else ''
            batch.save()

            return Response({
                'batch_id': str(batch.id),
                'rows_total': batch.rows_total,
                'rows_parsed': batch.rows_parsed,
                'rows_failed': batch.rows_failed,
                'rows_flagged': batch.rows_flagged,
                'errors': errors[:5],
            }, status=201)

        except Exception as e:
            batch.status = 'failed'
            batch.error_summary = str(e)
            batch.save()
            return Response({'error': str(e)}, status=500)


class BatchListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_slug = request.query_params.get('client_slug')
        qs = SourceBatch.objects.select_related('client', 'uploaded_by')
        if client_slug:
            qs = qs.filter(client__slug=client_slug)
        data = [{
            'id': str(b.id),
            'client': b.client.name,
            'client_slug': b.client.slug,
            'source_type': b.source_type,
            'source_type_display': b.get_source_type_display(),
            'uploaded_by': b.uploaded_by.username if b.uploaded_by else 'system',
            'uploaded_at': b.uploaded_at.isoformat(),
            'filename': b.filename,
            'status': b.status,
            'rows_total': b.rows_total,
            'rows_parsed': b.rows_parsed,
            'rows_failed': b.rows_failed,
            'rows_flagged': b.rows_flagged,
        } for b in qs[:100]]
        return Response(data)


class RecordListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_slug = request.query_params.get('client_slug')
        scope = request.query_params.get('scope')
        record_status = request.query_params.get('status')
        batch_id = request.query_params.get('batch_id')

        qs = EmissionRecord.objects.select_related('client', 'batch', 'reviewed_by')
        if client_slug:
            qs = qs.filter(client__slug=client_slug)
        if scope:
            qs = qs.filter(scope=scope)
        if record_status:
            qs = qs.filter(status=record_status)
        if batch_id:
            qs = qs.filter(batch_id=batch_id)

        # Summary stats
        total = qs.count()
        pending = qs.filter(status='pending').count()
        flagged = qs.filter(status='flagged').count()
        approved = qs.filter(status='approved').count()
        rejected = qs.filter(status='rejected').count()

        page = int(request.query_params.get('page', 1))
        page_size = 50
        offset = (page - 1) * page_size
        records = qs[offset:offset + page_size]

        data = {
            'summary': {
                'total': total, 'pending': pending, 'flagged': flagged,
                'approved': approved, 'rejected': rejected,
            },
            'results': [serialize_record(r) for r in records],
            'page': page,
            'total_pages': (total + page_size - 1) // page_size,
        }
        return Response(data)


class RecordDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            r = EmissionRecord.objects.get(pk=pk)
        except EmissionRecord.DoesNotExist:
            return Response({'error': 'Not found'}, status=404)
        record_data = serialize_record(r)
        record_data['raw_data'] = r.raw_row.raw_data if r.raw_row else None
        record_data['audit_logs'] = [{
            'action': log.action,
            'performed_by': log.performed_by.username if log.performed_by else None,
            'timestamp': log.timestamp.isoformat(),
            'field_changed': log.field_changed,
            'old_value': log.old_value,
            'new_value': log.new_value,
            'note': log.note,
        } for log in r.audit_logs.all()[:20]]
        return Response(record_data)

    def patch(self, request, pk):
        try:
            record = EmissionRecord.objects.get(pk=pk)
        except EmissionRecord.DoesNotExist:
            return Response({'error': 'Not found'}, status=404)

        action = request.data.get('action')
        note = request.data.get('note', '')

        if action in ('approved', 'rejected', 'flagged'):
            old_status = record.status
            record.status = action
            record.reviewed_by = request.user
            from django.utils import timezone
            record.reviewed_at = timezone.now()
            record.review_note = note
            record.save()
            AuditLog.objects.create(
                record=record, action=action, performed_by=request.user,
                field_changed='status', old_value=old_status, new_value=action, note=note,
            )
            return Response({'status': 'updated', 'new_status': action})

        # Field edit
        editable_fields = ['location', 'activity_date', 'source_quantity', 'source_unit',
                           'quantity_kg_co2e', 'emission_factor', 'flag_reason']
        changed = []
        for field in editable_fields:
            if field in request.data:
                old_val = str(getattr(record, field, ''))
                setattr(record, field, request.data[field])
                AuditLog.objects.create(
                    record=record, action='edited', performed_by=request.user,
                    field_changed=field, old_value=old_val, new_value=str(request.data[field]),
                )
                changed.append(field)
        if changed:
            record.was_edited = True
            record.save()
        return Response({'status': 'updated', 'fields_changed': changed})


class BulkActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        record_ids = request.data.get('record_ids', [])
        action = request.data.get('action')
        note = request.data.get('note', '')

        if action not in ('approved', 'rejected', 'flagged'):
            return Response({'error': 'Invalid action'}, status=400)

        from django.utils import timezone
        records = EmissionRecord.objects.filter(id__in=record_ids)
        updated = 0
        for record in records:
            old_status = record.status
            record.status = action
            record.reviewed_by = request.user
            record.reviewed_at = timezone.now()
            record.review_note = note
            record.save()
            AuditLog.objects.create(
                record=record, action=action, performed_by=request.user,
                field_changed='status', old_value=old_status, new_value=action, note=note,
            )
            updated += 1
        return Response({'updated': updated})


class SummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        client_slug = request.query_params.get('client_slug')
        qs = EmissionRecord.objects.all()
        if client_slug:
            qs = qs.filter(client__slug=client_slug)

        from django.db.models import Sum, Count
        scope_totals = {}
        for scope in [1, 2, 3]:
            result = qs.filter(scope=scope).aggregate(
                total_co2e=Sum('quantity_kg_co2e'),
                count=Count('id')
            )
            scope_totals[f'scope_{scope}'] = {
                'kg_co2e': float(result['total_co2e'] or 0),
                'count': result['count'],
            }

        status_counts = {
            s: qs.filter(status=s).count()
            for s in ['pending', 'approved', 'rejected', 'flagged']
        }

        return Response({
            'scope_totals': scope_totals,
            'status_counts': status_counts,
            'total_records': qs.count(),
        })


class ClientListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        clients = Client.objects.all()
        return Response([{
            'id': str(c.id), 'name': c.name, 'slug': c.slug, 'country': c.country
        } for c in clients])


class LoginInfoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            'username': request.user.username,
            'email': request.user.email,
            'is_staff': request.user.is_staff,
        })


def serialize_record(r):
    return {
        'id': str(r.id),
        'client': r.client.name,
        'client_slug': r.client.slug,
        'batch_id': str(r.batch_id),
        'scope': r.scope,
        'scope_display': r.get_scope_display(),
        'category': r.category,
        'category_display': r.get_category_display(),
        'status': r.status,
        'activity_date': r.activity_date.isoformat() if r.activity_date else None,
        'period_start': r.period_start.isoformat() if r.period_start else None,
        'period_end': r.period_end.isoformat() if r.period_end else None,
        'location': r.location,
        'sap_plant_code': r.sap_plant_code,
        'source_quantity': str(r.source_quantity),
        'source_unit': r.source_unit,
        'quantity_kwh': str(r.quantity_kwh) if r.quantity_kwh else None,
        'distance_km': str(r.distance_km) if r.distance_km else None,
        'emission_factor': str(r.emission_factor) if r.emission_factor else None,
        'emission_factor_source': r.emission_factor_source,
        'quantity_kg_co2e': str(r.quantity_kg_co2e) if r.quantity_kg_co2e else None,
        'fuel_type': r.fuel_type,
        'utility_meter_id': r.utility_meter_id,
        'travel_origin': r.travel_origin,
        'travel_destination': r.travel_destination,
        'travel_class': r.travel_class,
        'flag_reason': r.flag_reason,
        'was_edited': r.was_edited,
        'reviewed_by': r.reviewed_by.username if r.reviewed_by else None,
        'reviewed_at': r.reviewed_at.isoformat() if r.reviewed_at else None,
        'review_note': r.review_note,
        'created_at': r.created_at.isoformat(),
    }
