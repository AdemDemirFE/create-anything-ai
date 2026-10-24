<!--
Pull request rules (summary). The authoritative rules live in
docs/DEVELOPMENT_WORKFLOW.md and docs/QUALITY_GATES.md. Keep PRs small and
focused; do not open a single PR that implements all 40 stacks.
-->

## Changes

<!-- What does this PR change and why? Which task/issue does it implement? -->

- [ ] Scope and motivation are clear.
- [ ] Only files within the assigned task scope were touched.
- [ ] Stack maturity and compatibility claims are accurate.
- [ ] No unrelated formatting churn.

## Tests executed and results

<!-- List each command you actually ran and its result. Never report a check
     as passed if it was not executed. If a runtime was unavailable, say so. -->

| Command | Result (exit code / outcome) |
| --- | --- |
|  |  |

- [ ] Every check listed above was actually executed (not assumed).
- [ ] Commands that could not be run locally are stated explicitly.

## Security assessment

- [ ] No secret values or credentials were added or logged.
- [ ] `git diff` reviewed; no unexpected files or generated artifacts.
- [ ] Secret scan passes, or findings are triaged with a reason.
- [ ] Workflow/dependency permissions remain least-privilege.

## Known gaps and limitations

<!-- Runtime/tooling limitations, skipped checks, follow-up work. -->

- 

## Verification status

<!-- State clearly whether this work is verified, partially verified, or not
     yet verified, and what would be needed to complete verification. -->

- [ ] Verified
- [ ] Partially verified (gaps listed above)
- [ ] Not yet verified (explain what is missing)

## Breaking changes and migration steps

<!-- If none, write "None". -->

- 

## Additional evidence

<!-- Screenshots, CI run links, or test artifacts when useful. -->

- 
