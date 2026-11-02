#!/usr/bin/env bash
set -eu
npx --yes npm@12.2.0 ci --prefix api --include=dev
npx --yes npm@12.2.0 ci --prefix web --include=dev
npx --yes npm@12.2.0 run build:release --prefix api
npx --yes npm@12.2.0 prune --prefix api --omit=dev
