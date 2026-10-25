"""Email-as-username User model (the paradigm: swap the user model early,
migrate everything else around it)."""

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    username = None
    email = models.EmailField(unique=True)
    # Username field replaced by email; Django's password/check machinery and
    # session auth work unchanged.

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    def __str__(self) -> str:
        return self.email
