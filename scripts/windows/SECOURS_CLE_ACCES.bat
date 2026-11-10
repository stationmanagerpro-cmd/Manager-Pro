@echo off
REM Recours cle d acces - a lancer sur le PC serveur. Exemples : SECOURS_CLE_ACCES.bat status ^| open ^| new-key 24 ^| new-recovery
cd /d "%~dp0..\.."
node scripts\access-key-rescue.js %*
pause
