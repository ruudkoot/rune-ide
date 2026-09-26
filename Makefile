RUNE_ROOT ?= /home/ruud/rune
export RUNE_ROOT
unexport ELECTRON_RUN_AS_NODE
export PATH := $(CURDIR)/.tools/node_modules/node/bin:$(PATH)

.PHONY: setup millet service compiler dev check check-hosts package test-ui
setup:
	npm install --prefix .tools --no-package-lock --no-audit --no-fund node@24
	npm ci
millet:
	python3 scripts/gen-build-files.py
service: millet
	python3 scripts/build-service.py
compiler:
	python3 scripts/build-compiler.py
dev: service compiler
	npm start
check: service compiler
	npm test
check-hosts: compiler
	python3 scripts/check-hosts.py
package: service compiler
	npm run package
test-ui: package
	npm run test:ui
