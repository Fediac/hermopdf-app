; HermoPDF - ozel NSIS adimlari (electron-builder bunu build/installer.nsh olarak kendiliginden ekler).
;
; Amac (yalnizca gorunum): eski adli surumlerden ("PDF Usta", "Ultronix PDF") yukseltenlerde kurulum klasoru
; ...\Programs\PDF Usta ya da ...\Programs\Ultronix PDF olarak kalmasin, ...\Programs\HermoPDF (${APP_FILENAME}) olsun. Ara surumdeki "UltronPDF" klasoru de ayni sekilde cevrilir.
; Eski surumun kaldirilmasi bundan etkilenmez: uninstallOldVersion eski klasoru kayit defterindeki InstallLocation
; degerinden okur ($INSTDIR'den degil); kayit defteri yeni klasorle ancak kurulum sonunda (registryAddInstallInfo) yazilir.

; $INSTDIR "\<eski ad>" ile bitiyorsa son parcayi ${APP_FILENAME} yap. Kullanim: !insertmacro hermopdfReplaceTail "\PDF Usta" 9
!macro hermopdfReplaceTail TAIL LEN
  StrLen $R8 $INSTDIR
  ${If} $R8 > ${LEN}
    IntOp $R9 $R8 - ${LEN}
    StrCpy $R7 $INSTDIR "" $R9
    ${If} $R7 == "${TAIL}"
      StrCpy $R7 $INSTDIR $R9
      StrCpy $INSTDIR "$R7\${APP_FILENAME}"
    ${EndIf}
  ${EndIf}
!macroend

!macro hermopdfMigrateInstDir
  Push $R7
  Push $R8
  Push $R9
  !insertmacro hermopdfReplaceTail "\PDF Usta" 9
  !insertmacro hermopdfReplaceTail "\Ultronix PDF" 13
  !insertmacro hermopdfReplaceTail "\UltronPDF" 10
  Pop $R9
  Pop $R8
  Pop $R7
!macroend

; 1) Kurulum penceresi acilirken (sessiz kurulumda tek gecerli nokta)
!macro customInit
  !insertmacro hermopdfMigrateInstDir
!macroend

; 2) Kurulum kipi sayfasi $INSTDIR'i kayit defterinden yeniden okur; bu yuzden klasor secildikten sonra bir kez daha duzelt.
;    Gizli sayfa: gorunmez, hemen atlanir.
!macro customPageAfterChangeDir
  Function hermopdfFixInstDirPage
    !insertmacro hermopdfMigrateInstDir
    Abort
  FunctionEnd
  Page custom hermopdfFixInstDirPage
!macroend
