---
title: Git Best Practices
inclusion: always
---

# Git Best Practices

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): short imperative description
```

### Rules
- Subject line under 50 characters
- Use imperative mood ("add feature" not "added feature")
- No period at the end of the subject
- Include body for complex changes (separated by blank line)

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or user-facing change |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build, tooling, config, dependency updates |
| `style` | Formatting, whitespace (no logic change) |
| `perf` | Performance improvement |

### Scopes

| Scope | Area |
|-------|------|
| `web` | React web UI |
| `api` | Control API (Express routes, middleware) |
| `s7` | S7 PLC connector |
| `security` | Certificate/auth features |
| `dashboard` | Dashboard screen |
| `runtime` | C open62541 runtime |
| `db` | Database/repositories |
| `nodes` | Node/namespace management |

Omit scope for cross-cutting changes (e.g., `test: add stress test suite`).

### Examples

```
feat(s7): show live PLC values in mappings UI
fix(security): handle expired certificate gracefully
refactor(web): split S7 screen into focused components
test: add benchmark wrapper for CPU/memory profiling
chore: initial project setup
docs: update project structure and add commit convention
```

## Branching
- Use feature branches for new development
- Keep main branch stable and deployable
- Use descriptive branch names (`feature/user-auth`, `fix/login-bug`)
- Delete merged branches to keep repository clean

## Workflow
- Pull latest changes before starting work
- Commit frequently with logical chunks
- Review code before merging (pull requests)
- Push to a new branch, never directly to main (unless explicitly asked)

## Repository Management
- Use .gitignore to exclude build artifacts and secrets
- Keep repository size manageable (use Git LFS for large files)
- Tag releases with semantic versioning

## Security
- Never commit secrets, API keys, or passwords
- Use environment variables for configuration
- Review commits for sensitive information before pushing
