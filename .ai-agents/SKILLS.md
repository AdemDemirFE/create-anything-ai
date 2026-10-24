# Agent Skills and Tooling

## Recommended capabilities
- Official documentation lookup for version-sensitive APIs.
- Browser automation for user journeys and accessibility smoke checks.
- Database inspection only against local/test databases.
- GitHub PR and CI inspection with least-privilege credentials.
- Secret and dependency scanning.
- JSON Schema validation and stack catalog consistency checks.

## Tool safety
- MCP tools are optional capabilities, not assumed to be installed.
- Confirm tool availability before writing instructions that depend on it.
- Do not connect an agent to production databases by default.
- Do not expose credentials in tool outputs or prompts.
- Browser automation must use synthetic accounts and non-production environments.
- Prefer official documentation and local source over unverified model recollection.
