#!/bin/sh
# Global `devdock` command for the Linux .deb. Runs the bundled Electron binary as plain Node (no display needed).
HERE="$(dirname "$(readlink -f "$0")")"
ROOT="$(dirname "$HERE")"
ELECTRON_RUN_AS_NODE=1 exec "$ROOT/devdock-app" "$ROOT/resources/app.asar.unpacked/scripts/cli.js" "$@"
