"""
Core data models for Breathe ESG ingestion platform.

Design decisions:
- Tenant isolation at every level (client FK on all data tables)
- SourceBatch tracks every ingestion job — audit trail lives here
- RawRow stores the original unparsed record — we never lose source data
- EmissionRecord is the normalized, unit-converted, scope-tagged row
- AuditLog captures every state change post-ingestion
"""

from django.db import models
from django.contrib.auth.models import User
import uuid


class Client(models.Model):
    """
    Multi-tenancy root. Every data row belongs to a client.
    In production this would gate QuerySets via middleware.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    country = models.CharField(max_length=2, help_text="ISO 3166-1 alpha-2")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class PlantCodeLookup(models.Model):
    """
    SAP plant codes are meaningless without a lookup table.
    Each client has their own plant codes → location/region mapping.
    """
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='plant_codes')
    sap_code = models.CharField(max_length=50)
    location_name = models.CharField(max_length=255)
    country = models.CharField(max_length=2)
    region = models.CharField(max_length=100, blank=True)

    class Meta:
        unique_together = ('client', 'sap_code')

    def __str__(self):
        return f"{self.client.slug}:{self.sap_code} → {self.location_name}"


class SourceBatch(models.Model):
    """
    One ingestion job. Tracks provenance for every row in the batch.
    This is the audit trail anchor — who uploaded what, when, what happened.
    """
    SOURCE_SAP = 'sap'
    SOURCE_UTILITY = 'utility'
    SOURCE_TRAVEL = 'travel'
    SOURCE_CHOICES = [
        (SOURCE_SAP, 'SAP Fuel/Procurement'),
        (SOURCE_UTILITY, 'Utility/Electricity'),
        (SOURCE_TRAVEL, 'Corporate Travel'),
    ]

    STATUS_PENDING = 'pending'
    STATUS_PROCESSING = 'processing'
    STATUS_DONE = 'done'
    STATUS_FAILED = 'failed'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_PROCESSING, 'Processing'),
        (STATUS_DONE, 'Done'),
        (STATUS_FAILED, 'Failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='batches')
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    filename = models.CharField(max_length=512, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)

    # Counts updated after parsing
    rows_total = models.IntegerField(default=0)
    rows_parsed = models.IntegerField(default=0)
    rows_failed = models.IntegerField(default=0)
    rows_flagged = models.IntegerField(default=0)

    error_summary = models.TextField(blank=True)

    # The raw file stored for re-processing
    raw_file = models.FileField(upload_to='raw_uploads/', blank=True, null=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f"{self.client.slug} / {self.source_type} / {self.uploaded_at:%Y-%m-%d}"


class RawRow(models.Model):
    """
    Verbatim copy of each row as it arrived. Never mutated after insert.
    If parsing logic changes, we can re-derive EmissionRecords from these.
    This is the source-of-truth for what the client actually sent us.
    """
    batch = models.ForeignKey(SourceBatch, on_delete=models.CASCADE, related_name='raw_rows')
    row_index = models.IntegerField(help_text="0-based row number in the source file")
    raw_data = models.JSONField(help_text="Original key-value pairs, keys preserved as-is from source")
    parse_error = models.TextField(blank=True, help_text="Non-empty if this row failed to parse")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('batch', 'row_index')
        ordering = ['row_index']

    def __str__(self):
        return f"RawRow {self.row_index} / {self.batch_id}"


class EmissionRecord(models.Model):
    """
    Normalized, unit-converted, scope-tagged emission row.
    This is what analysts review. Every field here is in canonical units.

    Unit normalization:
    - quantity_kwh: kWh for energy (electricity, fuel converted via calorific value)
    - quantity_kg_co2e: kg CO2e (derived from quantity × emission factor)
    - distance_km: km for travel legs
    All source units are preserved in source_unit for traceability.

    Scope classification per GHG Protocol:
    - Scope 1: Direct combustion (diesel, petrol, gas from SAP fuel data)
    - Scope 2: Purchased electricity (utility data)
    - Scope 3: Business travel (flights, hotels, ground transport)
    """
    SCOPE_1 = 1
    SCOPE_2 = 2
    SCOPE_3 = 3
    SCOPE_CHOICES = [(1, 'Scope 1'), (2, 'Scope 2'), (3, 'Scope 3')]

    CATEGORY_FUEL = 'fuel'
    CATEGORY_PROCUREMENT = 'procurement'
    CATEGORY_ELECTRICITY = 'electricity'
    CATEGORY_FLIGHT = 'flight'
    CATEGORY_HOTEL = 'hotel'
    CATEGORY_GROUND = 'ground_transport'
    CATEGORY_CHOICES = [
        (CATEGORY_FUEL, 'Fuel (direct combustion)'),
        (CATEGORY_PROCUREMENT, 'Procurement / purchased goods'),
        (CATEGORY_ELECTRICITY, 'Grid electricity'),
        (CATEGORY_FLIGHT, 'Air travel'),
        (CATEGORY_HOTEL, 'Hotel accommodation'),
        (CATEGORY_GROUND, 'Ground transport'),
    ]

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_FLAGGED = 'flagged'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending review'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
        (STATUS_FLAGGED, 'Flagged / needs attention'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='emission_records')
    batch = models.ForeignKey(SourceBatch, on_delete=models.CASCADE, related_name='emission_records')
    raw_row = models.OneToOneField(RawRow, on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='emission_record')

    # Classification
    scope = models.IntegerField(choices=SCOPE_CHOICES)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)

    # Temporal
    activity_date = models.DateField(help_text="Date of activity (normalized from source)")
    period_start = models.DateField(null=True, blank=True, help_text="For billing-period data (utility)")
    period_end = models.DateField(null=True, blank=True)

    # Location / entity
    location = models.CharField(max_length=255, blank=True)
    sap_plant_code = models.CharField(max_length=50, blank=True)
    department = models.CharField(max_length=255, blank=True)
    employee_id = models.CharField(max_length=100, blank=True, help_text="For travel records")

    # Source quantity (original unit, for traceability)
    source_quantity = models.DecimalField(max_digits=20, decimal_places=6)
    source_unit = models.CharField(max_length=50, help_text="e.g. liters, kWh, MWh, kg, miles")

    # Normalized quantity
    quantity_kwh = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True,
                                        help_text="Energy in kWh (null for non-energy records)")
    distance_km = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True,
                                       help_text="Distance in km (travel records only)")

    # Emission calculation
    emission_factor = models.DecimalField(max_digits=20, decimal_places=8, null=True, blank=True,
                                           help_text="kg CO2e per unit (kWh or km)")
    emission_factor_source = models.CharField(max_length=255, blank=True,
                                               help_text="e.g. UK DESNZ 2024, ICAO, DEFRA")
    quantity_kg_co2e = models.DecimalField(max_digits=20, decimal_places=4, null=True, blank=True,
                                            help_text="Calculated kg CO2e")

    # Source tracking
    source_vendor = models.CharField(max_length=255, blank=True, help_text="Vendor/supplier from SAP")
    source_material_code = models.CharField(max_length=100, blank=True)
    fuel_type = models.CharField(max_length=100, blank=True, help_text="diesel, natural_gas, petrol, etc.")
    utility_meter_id = models.CharField(max_length=100, blank=True)
    travel_origin = models.CharField(max_length=10, blank=True, help_text="IATA airport code")
    travel_destination = models.CharField(max_length=10, blank=True)
    travel_class = models.CharField(max_length=20, blank=True, help_text="economy, business, first")

    # Quality flags
    flag_reason = models.TextField(blank=True, help_text="Why this row was auto-flagged")
    was_edited = models.BooleanField(default=False, help_text="True if analyst edited any field post-ingestion")

    # Review trail
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='reviewed_records')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-activity_date']
        indexes = [
            models.Index(fields=['client', 'status']),
            models.Index(fields=['client', 'scope']),
            models.Index(fields=['batch']),
            models.Index(fields=['activity_date']),
        ]

    def __str__(self):
        return f"{self.client.slug} | {self.get_category_display()} | {self.activity_date} | {self.quantity_kg_co2e} kg CO2e"


class AuditLog(models.Model):
    """
    Immutable log of every state change to an EmissionRecord.
    Created automatically by signals. Never edited or deleted.
    Required for auditor review.
    """
    ACTION_CREATED = 'created'
    ACTION_APPROVED = 'approved'
    ACTION_REJECTED = 'rejected'
    ACTION_FLAGGED = 'flagged'
    ACTION_EDITED = 'edited'
    ACTION_CHOICES = [
        (ACTION_CREATED, 'Created'),
        (ACTION_APPROVED, 'Approved'),
        (ACTION_REJECTED, 'Rejected'),
        (ACTION_FLAGGED, 'Flagged'),
        (ACTION_EDITED, 'Field edited'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    record = models.ForeignKey(EmissionRecord, on_delete=models.CASCADE, related_name='audit_logs')
    action = models.CharField(max_length=20, choices=ACTION_CHOICES)
    performed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    field_changed = models.CharField(max_length=100, blank=True)
    old_value = models.TextField(blank=True)
    new_value = models.TextField(blank=True)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"AuditLog:{self.action} on {self.record_id} by {self.performed_by}"
