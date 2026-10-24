"""Root URLconf extras: healthz + root redirect live outside the app namespace."""

from django.urls import path

from core import views

app_name = "config"

urlpatterns = [
    path("healthz", views.healthz, name="healthz"),
    path("", views.home_redirect, name="root"),
]
