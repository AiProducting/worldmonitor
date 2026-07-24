# AI Agent Instructions

## Repository: worldmonitor

- **Organization**: AiProducting
- **Enterprise**: iAiFy

Real-time global intelligence dashboard. TypeScript SPA (Vite + Preact) with 166 top-level TypeScript component files, 80+ Vercel Edge API endpoint entries, a Tauri desktop app with Node.js sidecar, and a Railway relay service. Aggregates geopolitics, military, finance, climate, cyber, maritime, and aviation data across 35 freshness-tracked source groups.

| Resource | Reference |
|---|---|
| Reusable workflows | `Ai-road-4-You/enterprise-ci-cd@v1` |
| Composite actions | `Ai-road-4-You/github-actions@v1` |
| Governance docs | `Ai-road-4-You/governance` |
| Repo templates | `Ai-road-4-You/repo-templates` |

```
.
├── src/                    # Browser SPA (TypeScript, class-based components)
│   ├── app/                # App orchestration (data-loader, refresh-scheduler, panel-layout)
│   ├── bootstrap/          # Startup/recovery (chunk reload, deferred Sentry, SW update)
│   ├── components/         # 166 top-level TypeScript component files
│   ├── config/             # Variant configs, panel/layer definitions, market symbols
│   ├── services/           # Business logic (202 service modules and domain directories)
│   ├── shared/             # Cross-cutting helpers (premium paths, registries, staleness)
│   ├── embed/              # Embeddable widget loader
│   ├── styles/             # Global CSS (layers, themes, panel styles)
│   ├── shims/              # Runtime shims (child-process for sidecar)
│   ├── data/               # Static JSON datasets (conservation, renewable, happiness)
│   ├── e2e/                # Map test harnesses (consumed by Playwright specs)
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Shared utilities (circuit-breaker, theme, URL state, DOM)
│   ├── workers/            # Web Workers (analysis, ML/ONNX, vector DB)
│   ├── generated/          # Proto-generated client/server stubs (DO NOT EDIT)
│   ├── locales/            # i18n translation files
│   └── App.ts              # Main application entry
├── api/                    # Vercel Edge Functions (plain JS, self-contained)
│   ├── _*.js               # Shared helpers (CORS, rate-limit, API key, relay)
│   ├── health.js           # Health check endpoint
│   ├── bootstrap.js        # Bulk data hydration endpoint
│   └── <domain>/           # Domain-specific endpoints (aviation/, climate/, etc.)
├── server/                 # Server-side shared code (used by Edge Functions)
│   ├── _shared/            # Redis, rate-limit, LLM, caching, response headers
│   ├── gateway.ts          # Domain gateway factory (CORS, auth, cache tiers)
│   ├── router.ts           # Route matching
│   └── worldmonitor/       # Domain handlers (mirrors proto service structure)
├── proto/                  # Protobuf definitions (sebuf framework)
│   ├── buf.yaml            # Buf configuration
│   └── worldmonitor/       # Service definitions with HTTP annotations
├── shared/                 # Cross-platform data (JSON configs for markets, RSS domains)
├── data/                   # Static data (telegram channels, OREF threat translations, gamma irradiators)
├── public/                 # Static assets served as-is (favicons, textures, .well-known, llms.txt)
├── scripts/                # Seed scripts, build helpers, data fetchers
├── src-tauri/              # Tauri desktop shell (Rust + Node.js sidecar)
│   └── sidecar/            # Node.js sidecar API server
├── consumer-prices-core/   # Consumer-price scrapers (Playwright, per-country baskets; Railway/Docker)
├── workers/                # Cloudflare Workers (edge CORS preflight for api.worldmonitor.app)
├── tests/                  # Unit/integration tests (node:test runner)
├── e2e/                    # Playwright E2E specs
├── pro-test/               # Standalone Pro QA app (separate package)
├── docs/                   # Mintlify documentation site
│   └── solutions/          # Documented solutions to past problems (bugs, patterns, practices) — YAML frontmatter (module, tags, problem_type)
├── docker/                 # Docker build for Railway services
├── deploy/                 # Deployment configs (nginx)
├── CONCEPTS.md             # Shared domain vocabulary (entities, named processes, status concepts)
└── blog-site/              # Static blog (built into public/blog/)
```

1. Use **conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`)
2. Create **feature branches** for all changes
3. Never push directly to `main`
4. Run tests before submitting PR
5. Keep dependencies updated via Dependabot
6. All file names in **kebab-case**

## Quality Gates

Before merging any PR:

- [ ] Lint passes
- [ ] Tests pass (if test suite exists)
- [ ] No new security vulnerabilities
- [ ] PR has meaningful description
- [ ] Conventional commit messages used

## Branch Strategy

- `main` — Production-ready, protected
- `feature/*` — New features
- `fix/*` — Bug fixes
- `chore/*` — Maintenance

## Agent Guardrails

- Maximum autonomous change: single file or single PR
- No force pushes
- No branch deletion without approval
- No secrets in code or commits
- All agent changes must be traceable via commit author
