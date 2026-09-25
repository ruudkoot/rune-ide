RUNE_ROOT ?= /home/ruud/rune
export RUNE_ROOT
unexport ELECTRON_RUN_AS_NODE
export PATH := $(CURDIR)/.tools/node_modules/node/bin:$(PATH)

.PHONY: setup service dev check check-hosts package test-ui
setup:
	npm install --prefix .tools --no-package-lock --no-audit --no-fund node@24
	npm ci
service:
	python3 scripts/build-service.py
dev: service
	npm start
check: service
	npm test
check-hosts:
	python3 scripts/check-hosts.py
package: service
	npm run package
test-ui: package
	npm run test:ui
