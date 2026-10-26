#!/usr/bin/env bash
set -euo pipefail
# Run native credential tests in a disposable D-Bus/keyring session.
# Never unlock or write to the developer's personal keyring.
if [[ ${BRIDGE_ISOLATED_DBUS:-} != 1 ]]; then
  exec dbus-run-session -- env BRIDGE_ISOLATED_DBUS=1 bash "$0" "$@"
fi
test_root=$(mktemp -d -t codex-linux-test-XXXXXXXX)
trap 'gnome-keyring-daemon --quit >/dev/null 2>&1 || true; rm -rf -- "$test_root"' EXIT
export XDG_DATA_HOME="$test_root/data"
export XDG_CONFIG_HOME="$test_root/config"
export XDG_CACHE_HOME="$test_root/cache"
export XDG_RUNTIME_DIR="$test_root/runtime"
export XDG_CURRENT_DESKTOP=GNOME
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
printf 'synthetic-test-keyring-password' | gnome-keyring-daemon --unlock --components=secrets >/dev/null
if [[ $# == 0 ]]; then
  npm run test:desktop
else
  "$@"
fi
