"""Admin registration — the Django admin is the paradigm showcase bonus.

 Activated deliberately: the ORM + auto-generated CRUD admin is a core part of
the batteries-included contrast this stack demonstrates against hand-rolled
server-rendered stacks (e.g. Stack-04's Go + htmx).
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from core.models import Note, User


@admin.register(User)
class EmailUserAdmin(DjangoUserAdmin):
    """User admin reworked for the email-as-username model."""

    ordering = ["email"]
    list_display = ["email", "is_active", "is_staff", "date_joined"]
    search_fields = ["email"]
    list_filter = ["is_active", "is_staff"]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ["title", "owner", "created_at", "updated_at"]
    list_filter = ["created_at"]
    search_fields = ["title", "body", "owner__email"]
    readonly_fields = ["created_at", "updated_at"]
