# Decision Log

Append-only. One entry per decision, newest last. Include date, decider, context, and consequence.

## D-001: GLM_AIHub_SETUP.md contains no real credentials (2026-10-24, worker-1)

- **Context:** TASK-001 required auditing `docs/GLM_AIHub_SETUP.md` for real API keys or tokens before publication.
- **Finding:** The document was audited. `AIHUB_API_KEY` is intentionally empty (`AIHUB_API_KEY=`) and no token-shaped strings (`ghp_`, `sk-`, AWS/Google key formats, PEM blocks) appear anywhere in the file. The endpoint URL `https://aihub-api.turktelekom.com.tr/v1` is a public base URL, not a secret.
- **Action taken:** No redaction was necessary; the empty-key convention was kept and the surrounding guidance ("do not paste a real key") remains. A full-tree secret scan over the committed files found no matches.
- **Consequence:** Any future key material must go into a local ignored `.env` or a secret manager, never into this document or `.env.example`. If a real key is ever found committed, treat it as compromised: revoke it, then purge history.
