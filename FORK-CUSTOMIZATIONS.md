# Fork Customizations

> Upstream: [koala73/worldmonitor](https://github.com/koala73/worldmonitor)
> Fork maintained by: @ashsolei
> Last reviewed: 2026-04-08
> Fork type: **active-dev**
> Sync cadence: **monthly**

## Purpose of Fork

Real-time world-events monitor fork customized for iAiFy ingestion and alerting.

## Upstream Source

| Property | Value |
|---|---|
| Upstream | [koala73/worldmonitor](https://github.com/koala73/worldmonitor) |
| Fork org | AiProducting |
| Fork type | active-dev |
| Sync cadence | monthly |
| Owner | @ashsolei |

## Carried Patches

Local commits ahead of `upstream/main` at last review:

- `01dcfe21 chore: sync CLAUDE.md and copilot-instructions docs`
- `5186d430 chore(deps): bump h3 from 1.15.6 to 1.15.9 (#1)`
- `88b73184 ci: add github-actions ecosystem to dependabot`
- `31a77ffe docs: update FORK-CUSTOMIZATIONS.md with upstream source`
- `af88e4d4 docs: add FORK-CUSTOMIZATIONS.md per enterprise fork governance`
- `88505ee5 ci: add copilot-setup-steps.yml for Copilot Workspace`
- `a921b4c9 chore: add AGENTS.md`
- `13067809 chore: add CLAUDE.md`
- `7d1b91ca chore: add copilot-instructions.md`
- `ce8c098d chore: add Copilot Coding Agent setup steps`
- `cfd6d5e9 chore: remove misplaced agent files from .github/copilot/agents/`
- `d8962a40 chore: deploy core custom agents from AgentHub`
- `024791b7 chore: deploy core Copilot agents from AgentHub`
- `798a57b4 docs: add FORK-CUSTOMIZATIONS.md`
- `3b57f885 chore: add dependabot.yml [governance-orchestrator]`
- `5fd2a0f0 chore: add CODEOWNERS [governance-orchestrator]`
- `7db4a4ea chore: remove workflow typecheck.yml — enterprise cleanup`
- `22d9458e chore: remove workflow test-linux-app.yml — enterprise cleanup`
- `063b05a7 chore: remove workflow proto-check.yml — enterprise cleanup`
- `50475217 chore: remove workflow lint.yml — enterprise cleanup`
- `9c07a577 chore: remove workflow docker-publish.yml — enterprise cleanup`
- `398a2b1d chore: remove workflow build-desktop.yml — enterprise cleanup`

## Supported Components

- Root governance files (`.github/`, `CLAUDE.md`, `AGENTS.md`, `FORK-CUSTOMIZATIONS.md`)
- Enterprise CI/CD workflows imported from `Ai-road-4-You/enterprise-ci-cd`

## Out of Support

- All upstream source directories are tracked as upstream-of-record; local edits to core source are discouraged.

## Breaking-Change Policy

1. On upstream sync, classify per `governance/docs/fork-governance.md`.
2. Breaking API/license/security changes auto-classify as `manual-review-required`.
3. Owner triages within 5 business days; conflicts are logged to the `fork-sync-failure` issue label.
4. Revert local customizations only after stakeholder sign-off.

## Sync Strategy

This fork follows the [Fork Governance Policy](https://github.com/Ai-road-4-You/governance/blob/main/docs/fork-governance.md)
and the [Fork Upstream Merge Runbook](https://github.com/Ai-road-4-You/governance/blob/main/docs/runbooks/fork-upstream-merge.md).

- **Sync frequency**: monthly
- **Conflict resolution**: Prefer upstream; reapply iAiFy customizations on a sync branch
- **Automation**: [`Ai-road-4-You/fork-sync`](https://github.com/Ai-road-4-You/fork-sync) workflows
- **Failure handling**: Sync failures create issues tagged `fork-sync-failure`

## Decision: Continue, Rebase, Refresh, or Replace

| Option | Current Assessment |
|---|---|
| Continue maintaining fork | yes - active iAiFy product scope |
| Full rebase onto upstream | feasible on request |
| Fresh fork (discard local changes) | not acceptable without owner review |
| Replace with upstream directly | not possible (local product value) |

## Maintenance

- **Owner**: @ashsolei
- **Last reviewed**: 2026-04-08
- **Reference runbook**: `ai-road-4-you/governance/docs/runbooks/fork-upstream-merge.md`
