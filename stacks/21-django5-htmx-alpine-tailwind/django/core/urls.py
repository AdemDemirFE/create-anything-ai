"""App-level URLconf (the Django paradigm: apps own their routes)."""

from django.urls import path

from core import views

app_name = "core"

urlpatterns = [
    # Web (server-rendered four screens)
    path("register/", views.register_view, name="register"),
    path("login/", views.login_view, name="login"),
    path("home/", views.home_view, name="home"),
    path("algorithm/", views.algorithm_view, name="algorithm"),
    path("logout/", views.logout_view, name="logout"),
    path("notes/new/", views.note_create_view, name="note-create"),
    path("notes/<int:note_id>/delete/", views.note_delete_view, name="note-delete"),

    # API v1 (JSON envelope)
    path("api/v1/csrf", views.api_csrf, name="api-csrf"),
    path("api/v1/register", views.api_register, name="api-register"),
    path("api/v1/login", views.api_login, name="api-login"),
    path("api/v1/logout", views.api_logout, name="api-logout"),
    path("api/v1/me", views.api_me, name="api-me"),
    path("api/v1/home", views.api_home, name="api-home"),
    path("api/v1/notes", views.api_notes, name="api-notes"),
    path("api/v1/notes/<int:note_id>", views.api_note_detail, name="api-note-detail"),
    path("api/v1/algorithm", views.api_algorithm_catalog, name="api-algorithm"),
    path("api/v1/algorithm/run", views.api_algorithm_run, name="api-algorithm-run"),
]
