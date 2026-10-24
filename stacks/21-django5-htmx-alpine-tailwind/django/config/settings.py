"""
Django settings for the Stack 21 reference implementation
(Django 5 + htmx 2 + Alpine.js + built Tailwind CSS).

Environment policy:
- DJANGO_SECRET_KEY is read from the environment (see ../.env.example). In
  DEBUG mode a clearly-marked development-only fallback is used so a clean
  checkout boots without setup; production (DEBUG=False) fails fast without it.
- No secret is ever committed; .env is gitignored.
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise ImproperlyConfigured(f"{name} must be an integer: {raw!r}") from exc


# --- Core security switches -------------------------------------------------

DEBUG = _env_bool("DJANGO_DEBUG", True)

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "").strip()
if not SECRET_KEY:
    if DEBUG:
        # Dev-only fallback; identifiable so a leaked dev key is detectable.
        SECRET_KEY = "django-insecure-dev-only-stack21-do-not-use-in-production"
    else:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY is required when DJANGO_DEBUG is false. "
            "Copy .env.example to .env and set it."
        )

ALLOWED_HOSTS = [
    h.strip()
    for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
    if h.strip()
]

# --- Application definition --------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "core.apps.CoreConfig",
]

MIDDLEWARE = [
    "core.middleware.RequestIdMiddleware",  # outermost: every response carries X-Request-Id
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# --- Database (sqlite for the reference implementation; ORM is the point) ----

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# --- Auth ---------------------------------------------------------------------

# Custom email-based user model (core.models.User). Must be set before the
# first migrate; see core/models/user.py for the rationale.
AUTH_USER_MODEL = "core.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Session auth via HttpOnly cookie. Sessions live server-side (django_session
# table), so logout revocation is real: delete the row, the cookie dies with it.
SESSION_COOKIE_NAME = "stack21_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", False)
# Idle timeout: Django re-anchors expiry on every request when saving, so a
# session unused for 30 minutes expires even though login happened hours ago.
SESSION_COOKIE_AGE = _env_int("SESSION_COOKIE_AGE_SECONDS", 30 * 60)
SESSION_SAVE_EVERY_REQUEST = True

CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # htmx reads it to echo X-CSRFToken
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE

LOGIN_URL = "/login/"

# --- Internationalization -----------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# --- Static files (Tailwind build output + vendored htmx/Alpine) ---------------

STATIC_URL = "static/"
STATICFILES_DIRS = [BASE_DIR / "static"]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Stack 21 application settings --------------------------------------------

# Client IP resolution for the login throttle: X-Forwarded-For is honored only
# when the immediate TCP peer is listed here. Default empty → XFF ignored.
TRUSTED_PROXIES = [
    p.strip()
    for p in os.environ.get("TRUSTED_PROXIES", "").split(",")
    if p.strip()
]

# CSRF: framework middleware on EVERY state-changing request — there are no
# exemptions (register/login included; no session is needed to send the token,
# web forms embed {% csrf_token %} and API clients echo X-CSRFToken from
# GET /api/v1/csrf). See ARCHITECTURE.md §3.
CSRF_FAILURE_VIEW = "core.views.csrf_failure"

# Bounded workbench input (chars) and request body cap (bytes).
MAX_INPUT_CHARS = _env_int("MAX_INPUT_CHARS", 10_000)
MAX_BODY_BYTES = _env_int("MAX_BODY_BYTES", 256 * 1024)

# Failed-login throttle: attempts per window per email+client-IP, in process.
LOGIN_THROTTLE_LIMIT = _env_int("LOGIN_THROTTLE_LIMIT", 5)
LOGIN_THROTTLE_WINDOW_SECONDS = _env_int("LOGIN_THROTTLE_WINDOW_SECONDS", 60)

# Logging: default Django config; never log request bodies or credentials.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {
        "handlers": ["console"],
        "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO"),
    },
    "filters": {
        "require_debug_false": {"()": "django.utils.log.RequireDebugFalse"},
    },
}
