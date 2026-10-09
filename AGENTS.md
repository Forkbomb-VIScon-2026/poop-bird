# Agent notes

## Pull requests, not pushes to main

Never push to `main` directly (a ruleset rejects it anyway). Work on a branch
and open a pull request against `main` with auto-merge enabled:

```sh
gh pr create --fill
gh pr merge --auto --squash
```

GitHub merges the PR once the required checks (`check` and `docker` from
`ci.yml`) pass. If a check fails, the PR stays open: fix it on the branch.

Every merge to `main` deploys: once CI passes on `main`, `deploy.yml` ships the
build to the live VM. Green checks are all that stands between a PR and
production, so run `npm run lint`, `npm test` and `npm run build` locally first,
and actually try changes that the checks can't see (gameplay, camera, audio).
