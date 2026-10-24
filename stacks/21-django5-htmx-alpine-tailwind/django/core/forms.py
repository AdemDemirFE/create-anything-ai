"""Forms for the four screens. Django forms own validation (paradigm point:
server-side declarative validation, rendered as accessible field errors).

Widgets get Tailwind classes via a small mixin so the built stylesheet styles
them without a runtime dependency.
"""

from __future__ import annotations

from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password

INPUT_CLASSES = (
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm "
    "focus:border-slate-500 focus:outline-none"
)


class StyledFormsMixin:
    """Apply Tailwind input classes to every widget on the bound form."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            existing = field.widget.attrs.get("class", "")
            field.widget.attrs["class"] = f"{INPUT_CLASSES} {existing}".strip()


User = get_user_model()


class RegisterForm(StyledFormsMixin, forms.Form):
    email = forms.EmailField(
        label="Email",
        max_length=254,
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    password = forms.CharField(
        label="Password",
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )

    def clean_email(self):
        email = self.cleaned_data["email"].strip().lower()
        # Web form: same field error as any invalid email is WRONG here — the
        # sibling stacks surface a distinct EMAIL_TAKEN signal, so the fragment
        # re-render shows it; the JSON API keeps code parity via the view.
        return email

    def clean_password(self):
        password = self.cleaned_data["password"]
        validate_password(password)
        return password


class LoginForm(StyledFormsMixin, forms.Form):
    email = forms.EmailField(
        label="Email",
        max_length=254,
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    password = forms.CharField(
        label="Password",
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}),
    )


class NoteForm(StyledFormsMixin, forms.Form):
    title = forms.CharField(
        label="Title",
        max_length=120,
        widget=forms.TextInput(attrs={"maxlength": 120}),
    )
    body = forms.CharField(
        label="Body",
        max_length=2000,
        required=False,
        widget=forms.Textarea(attrs={"rows": 3, "maxlength": 2000}),
    )


class AlgorithmRunForm(StyledFormsMixin, forms.Form):
    algorithm = forms.ChoiceField(label="Algorithm")
    payload = forms.CharField(
        label="Input",
        max_length=None,
        required=True,
    )

    def __init__(self, data=None, *, choices, max_input_chars: int, **kwargs):
        super().__init__(data, **kwargs)
        self.fields["algorithm"].choices = choices
        self.max_input_chars = max_input_chars

    def clean_payload(self):
        payload = self.cleaned_data["payload"]
        if len(payload) > self.max_input_chars:
            raise forms.ValidationError(
                "Input exceeds the 10,000 character limit."
            )
        return payload
