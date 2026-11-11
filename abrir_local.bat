@echo off
rem Duplo clique para subir o site localmente (precisa do Python instalado).
cd /d "%~dp0"
python servidor_local.py %*
if errorlevel 1 pause
