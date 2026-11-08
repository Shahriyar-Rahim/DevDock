; Adds <install dir>\bin (devdock.cmd) to the current user's PATH. User data is never touched on uninstall.
!macro customInstall
  nsExec::Exec `powershell -NoProfile -Command "$$b='$INSTDIR\bin';$$u=[Environment]::GetEnvironmentVariable('Path','User');if(-not $$u){$$u=''};$$p=@($$u.Split(';')|Where-Object{$$_ -and $$_ -ne $$b});[Environment]::SetEnvironmentVariable('Path',(($$p+$$b) -join ';'),'User')"`
!macroend
!macro customUnInstall
  nsExec::Exec `powershell -NoProfile -Command "$$b='$INSTDIR\bin';$$u=[Environment]::GetEnvironmentVariable('Path','User');if($$u){[Environment]::SetEnvironmentVariable('Path',((@($$u.Split(';')|Where-Object{$$_ -and $$_ -ne $$b})) -join ';'),'User')}"`
!macroend
