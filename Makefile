RUNE_ROOT ?= /home/ruud/rune
export RUNE_ROOT
unexport ELECTRON_RUN_AS_NODE
export PATH := $(CURDIR)/.tools/node_modules/node/bin:$(PATH)
export RUNE_IDE_PACKAGE_PLATFORM ?= linux
export RUNE_IDE_PACKAGE_ARCH ?= x64

.PHONY: setup millet service compiler dev check check-hosts toolchain package archive test-ui
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
toolchain: service compiler
	python3 scripts/stage-toolchain.py --platform $(RUNE_IDE_PACKAGE_PLATFORM) --arch $(RUNE_IDE_PACKAGE_ARCH)
package: toolchain
	npm run package -- --platform=$(RUNE_IDE_PACKAGE_PLATFORM) --arch=$(RUNE_IDE_PACKAGE_ARCH)
	python3 scripts/verify-package.py out/Rune-$(RUNE_IDE_PACKAGE_PLATFORM)-$(RUNE_IDE_PACKAGE_ARCH)
archive: package
	python3 scripts/archive-package.py out/Rune-$(RUNE_IDE_PACKAGE_PLATFORM)-$(RUNE_IDE_PACKAGE_ARCH)
test-ui: package
	npm run test:ui
