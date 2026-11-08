@echo off
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\DevDock.exe" "%~dp0..\resources\app.asar.unpacked\scripts\cli.js" %*
