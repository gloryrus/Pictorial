!macro NSIS_HOOK_POSTUNINSTALL
  SetOutPath "$TEMP"
  RMDir /r /REBOOTOK "$INSTDIR"
!macroend
