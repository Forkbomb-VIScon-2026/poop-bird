# Agent notes

## Pull requests, not pushes to main

Never push to `main` directly. Work on a branch and open a pull request
against `main`.

Every push to `main` deploys: once CI passes, `deploy.yml` ships the build to
the live VM. Merging a PR therefore deploys too, so only merge when asked.
