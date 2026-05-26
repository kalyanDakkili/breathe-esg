from django.urls import path
from . import views

urlpatterns = [
    path('upload/<str:source_type>/', views.UploadView.as_view()),
    path('batches/', views.BatchListView.as_view()),
    path('records/', views.RecordListView.as_view()),
    path('records/<str:pk>/', views.RecordDetailView.as_view()),
    path('records/bulk-action/', views.BulkActionView.as_view()),
    path('summary/', views.SummaryView.as_view()),
    path('clients/', views.ClientListView.as_view()),
    path('me/', views.LoginInfoView.as_view()),
]
