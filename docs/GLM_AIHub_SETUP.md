# GLM-5.3-Flash-IT via AIHub

## 1. Purpose

This document describes how to use GLM-5.3-Flash-IT as the default implementation model for the Create Anything AI agent workflow through the AIHub OpenAI-compatible API.

Configured endpoint from the current workflow:

```text
https://aihub-api.turktelekom.com.tr/v1
```

Model/provider availability can change. Validate the endpoint, model identifier, permissions, and request format in the active environment; do not hardcode assumptions into the generator.

## 2. Configuration

Use environment variables or a secret manager. Example variable names:

```dotenv
AIHUB_BASE_URL=https://aihub-api.turktelekom.com.tr/v1
AIHUB_API_KEY=
AIHUB_MODEL=GLM-5.3-Flash-IT
AIHUB_TIMEOUT_MS=120000
AIHUB_MAX_RETRIES=3
AIHUB_MAX_CONCURRENCY=2
```

The empty key is intentional. Do not paste a real key into `.env.example`, Markdown, issue comments, prompts, or logs. Use a local ignored `.env` or your organization's approved secret store.

Confirm the exact model ID and authentication header expected by your AIHub deployment. OpenAI-compatible does not necessarily mean every endpoint, parameter, tool-call feature, or streaming behavior is identical.

## 3. Smoke-test checklist

Before running a multi-agent batch:
1. Verify network connectivity to the base endpoint.
2. Verify the API key is present without printing it.
3. Make one minimal request using the organization's approved client.
4. Confirm the selected model identifier is accepted.
5. Confirm response content and token usage metadata are parsed.
6. Test timeout and rate-limit handling.
7. Confirm errors do not print request headers or credentials.
8. Start with concurrency 1, then 2, and increase gradually based on measured throughput and provider limits.

Do not rely on `/v1/models` being enabled; some gateways restrict model-list endpoints. A failed model-list request does not alone prove inference is unavailable.

## 4. Concurrency and retry policy

- Default to low concurrency during initial validation.
- Make concurrency configurable; 6–7 agents do not necessarily mean seven simultaneous API requests are safe.
- Use a semaphore or queue to enforce global in-flight request limits.
- Apply exponential backoff with jitter only to retryable transient errors.
- Respect `Retry-After` where present.
- Do not retry `401`, `403`, invalid model IDs, or malformed requests repeatedly.
- Bound each task by time, output tokens, and retry count.
- Record latency and error category, not prompt secrets or full sensitive payloads.
- Stop or pause the queue if error rates or latency exceed configured thresholds.

## 5. Agent work pattern

Use GLM for bounded code, tests, documentation, and review. Keep the coordinator's architecture decisions explicit. Require independent verification for security-sensitive code, auth, migration logic, and generator path handling.

Every agent response must end with:
- summary;
- changed paths;
- commands executed;
- actual results and exit codes;
- unresolved risks;
- next action.

## 6. Failure modes

| Symptom | Likely categories | Response |
|---|---|---|
| Connection error | DNS, TLS, proxy, endpoint, network | Test connectivity and certificate chain; don't print credentials |
| 401/403 | Key, permission, model access | Verify authorization through approved channel |
| 404 | Wrong route/model ID or unsupported endpoint | Verify base URL and model ID |
| 429 | Rate limit or quota | Reduce concurrency, honor retry headers |
| 5xx | Provider/gateway transient failure | Bounded retry with jitter |
| Timeout | Model latency, network, oversized context | Reduce context/output and increase timeout only deliberately |
| Invalid tool-call format | API feature mismatch | Disable unsupported feature or adapt provider adapter |

## 7. Privacy and governance

- Send only the source code and context needed for the assigned task.
- Follow organizational rules for confidential code and data.
- Never send production secrets, personal records, credentials, or sensitive datasets.
- Do not assume API retention or training behavior; use the provider's current approved policy.
- Keep provider-specific settings out of stack manifests unless that stack truly requires them.
