.PHONY: help lint generate breaking format check clean deps install install-buf install-plugins install-npm install-playwright
.DEFAULT_GOAL := help

# Variables
PROTO_DIR := proto
GEN_CLIENT_DIR := src/generated/client
GEN_SERVER_DIR := src/generated/server
DOCS_API_DIR := docs/api

# Go install settings
GO_PROXY := GOPROXY=direct
GO_PRIVATE := GOPRIVATE=github.com/SebastienMelki
GO_INSTALL := $(GO_PROXY) $(GO_PRIVATE) go install

# Required tool versions
BUF_VERSION := v1.64.0
SEBUF_VERSION := v0.7.0

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: install-buf install-plugins install-npm install-playwright deps ## Install everything (buf, sebuf plugins, npm deps, proto deps, browsers)

install-buf: ## Install buf CLI
	@if command -v buf >/dev/null 2>&1; then \
		echo "buf already installed: $$(buf --version)"; \
	else \
		echo "Installing buf..."; \
		$(GO_INSTALL) github.com/bufbuild/buf/cmd/buf@$(BUF_VERSION); \
		echo "buf installed!"; \
	fi

install-plugins: ## Install sebuf protoc plugins (requires Go)
	@echo "Installing sebuf protoc plugins $(SEBUF_VERSION)..."
	@$(GO_INSTALL) github.com/SebastienMelki/sebuf/cmd/protoc-gen-ts-client@$(SEBUF_VERSION)
	@$(GO_INSTALL) github.com/SebastienMelki/sebuf/cmd/protoc-gen-ts-server@$(SEBUF_VERSION)
	@$(GO_INSTALL) github.com/SebastienMelki/sebuf/cmd/protoc-gen-openapiv3@$(SEBUF_VERSION)
	@echo "Plugins installed!"

install-npm: ## Install npm dependencies
	npm install

install-playwright: ## Install Playwright browsers for e2e tests
	npx playwright install chromium

deps: ## Install/update buf proto dependencies
	cd $(PROTO_DIR) && buf dep update

lint: ## Lint protobuf files
	cd $(PROTO_DIR) && buf lint

generate: clean ## Generate code from proto definitions
	@mkdir -p $(GEN_CLIENT_DIR) $(GEN_SERVER_DIR) $(DOCS_API_DIR)
	cd $(PROTO_DIR) && buf generate
	@echo "Code generation complete!"

breaking: ## Check for breaking changes against main
	cd $(PROTO_DIR) && buf breaking --against '.git#branch=main,subdir=proto'

format: ## Format protobuf files
	cd $(PROTO_DIR) && buf format -w

check: lint generate ## Run all checks (lint + generate)

# ── Upstream sync (read-only: pull from koala73/worldmonitor, never push) ─────

sync-upstream: ## Fetch latest upstream/main without merging (safe, read-only)
	@echo "Fetching upstream (koala73/worldmonitor)..."
	git fetch upstream
	@echo ""
	@echo "=== Commits in upstream/main not in your branch ==="
	git log HEAD..upstream/main --oneline --no-color | head -30 || true
	@echo ""
	@echo "=== Files changed in upstream/main since your branch diverged ==="
	git diff --stat HEAD...upstream/main | tail -20 || true
	@echo ""
	@echo "Run 'make preview-merge' to see full conflict analysis."

preview-merge: ## Preview merge from upstream/main into a temp branch (non-destructive)
	@echo "Creating temporary merge preview branch..."
	$(eval PREVIEW_BRANCH := preview/upstream-merge-$(shell date +%Y%m%d-%H%M%S))
	git checkout -b $(PREVIEW_BRANCH) HEAD
	@echo "Attempting merge of upstream/main into $(PREVIEW_BRANCH)..."
	git merge upstream/main --no-commit --no-ff || true
	@echo ""
	@echo "=== Merge status ==="
	git status --short
	@echo ""
	@echo "=== Conflicting files ==="
	git diff --name-only --diff-filter=U || true
	@echo ""
	@echo "Aborting merge and cleaning up preview branch..."
	git merge --abort 2>/dev/null || true
	git checkout - 
	git branch -D $(PREVIEW_BRANCH)
	@echo ""
	@echo "Preview complete. No changes were made to your working branch."

merge-upstream: ## Merge upstream/main into current branch (manual step — review first!)
	@echo "⚠ This will merge upstream/main into your current branch: $$(git branch --show-current)"
	@echo "Run 'make preview-merge' first to check for conflicts."
	@read -p "Continue? [y/N] " ans && [ "$$ans" = "y" ]
	git fetch upstream
	git merge upstream/main --no-ff -m "chore: merge upstream/main into $$(git branch --show-current)"

clean: ## Clean generated files
	@rm -rf $(GEN_CLIENT_DIR)
	@rm -rf $(GEN_SERVER_DIR)
	@rm -rf $(DOCS_API_DIR)
	@echo "Clean complete!"
