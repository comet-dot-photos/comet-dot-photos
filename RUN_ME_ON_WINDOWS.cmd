@echo off
call npm --prefix %~dp0server run local || echo npm run local interrupted
