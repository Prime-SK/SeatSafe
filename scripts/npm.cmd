@echo off
if not defined SEATSAFE_NODE_EXE (
  echo Activate the runtime first: . .\scripts\use-node.ps1
  exit /b 1
)
"%SEATSAFE_NODE_EXE%" "%SEATSAFE_NPM_CLI%" %*
