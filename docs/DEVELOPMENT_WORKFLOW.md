# Development and Git Workflow

## 1. Branch model

Use short-lived feature branches:
- `feat/<scope>`
- `fix/<scope>`
- `docs/<scope>`
- `security/<scope>`

Keep pull requests small and focused. Avoid a single PR that implements all 40 stacks.

## 2. Before work

```bash
git status --short
git branch --show-current
git pull --ff-only
```

Never begin by resetting, cleaning, or discarding work you did not create. If the working tree is dirty, inspect it and preserve user changes.

## 3. During multi-agent work

- Coordinator creates task IDs and assigns allowed paths.
- Workers do not commit or push.
- Use one integration owner.
- Review `git diff --stat` and `git diff --check` before tests.
- Inspect unexpected files and generated artifacts.
- Do not allow a worker to run `git reset --hard`, `git clean -fdx`, or broad deletion commands.

## 4. Commit rules

Recommended commit sequence:
1. documentation/contracts;
2. schemas/catalog;
3. generator and tests;
4. reference stack;
5. additional stack batches.

Each commit should build on a coherent change. Do not commit unverified output as a verified stack.

## 5. Pull request checklist

- [ ] Scope and motivation clear.
- [ ] Stack maturity and compatibility claims accurate.
- [ ] Tests and validations listed with actual results.
- [ ] Security scan passes or findings are triaged.
- [ ] No secret values or sensitive logs.
- [ ] Documentation updated.
- [ ] No unrelated formatting churn.
- [ ] Breaking changes and migration steps described.
- [ ] Screenshots or test artifacts attached when useful.
