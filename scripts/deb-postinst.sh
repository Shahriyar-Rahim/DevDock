#!/bin/sh
# Replaces electron-builder's default postinst, so it repeats the standard steps and adds the global `devdock` command.
ln -sf '/opt/DevDock/devdock-app' '/usr/bin/devdock-app'
chmod 755 /opt/DevDock/bin/devdock
ln -sf '/opt/DevDock/bin/devdock' '/usr/bin/devdock'
if ! { [ -L /proc/self/ns/user ] && unshare --user true; }; then chmod 4755 '/opt/DevDock/chrome-sandbox' || true; else chmod 0755 '/opt/DevDock/chrome-sandbox' || true; fi
if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
exit 0
