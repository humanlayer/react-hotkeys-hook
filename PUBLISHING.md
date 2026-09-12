# Publishing to npm

The root package publishes `@humanlayer/react-hotkeys-hook` from `packages/react-hotkeys-hook/dist`. `.github/workflows/publish.yml` validates and builds it, then uses npm trusted publishing with GitHub Actions OIDC. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is passed to the publish job.

## One-time maintainer setup

Use an npm account with write access to the package and account-level two-factor authentication enabled. These commands use a pinned npm CLI without changing your global installation; run them with Node 22.14+ or Node 24. They require Bun for `bunx`.

```bash
bunx --package npm@11.19.1 npm login
bunx --package npm@11.19.1 npm trust github @humanlayer/react-hotkeys-hook --repo humanlayer/react-hotkeys-hook --file publish.yml --allow-publish
bunx --package npm@11.19.1 npm trust list @humanlayer/react-hotkeys-hook
```

Complete the interactive login and 2FA prompts. Use the workflow filename `publish.yml`, not its full path. No GitHub environment is configured, so do not add `--environment`. The `--allow-publish` flag permits direct publication rather than only staged publication. If a publisher is already configured, inspect it with `trust list` before changing or revoking anything.

The equivalent npm website settings are GitHub owner `humanlayer`, repository `react-hotkeys-hook`, workflow `publish.yml`, no environment, and direct publishing allowed. Saving the configuration does not validate it; the first real publish verifies the trust relationship.

## Releasing

The workflow runs on `main` when root `package.json` changes, or can be dispatched manually on `main`. The publish job rejects other refs. It uses a GitHub-hosted runner, Node 24, pinned npm 11.19.1, `contents: read` and `id-token: write`. npm obtains its short-lived publish credential automatically and generates provenance for this public repository/package.

After merging the trusted-publishing workflow and configuring npm, start a **new run** to publish the pending 5.4.0 release:

```bash
gh workflow run publish.yml --repo humanlayer/react-hotkeys-hook --ref main
```

Do not rerun the previous failed token-based run: a rerun uses its original workflow revision. Watch the new run through completion and verify that the intended version is available on the registry before updating consumers.

After the first successful trusted publish, remove the unused repository `NPM_TOKEN` Actions secret and revoke the old npm token if no other workflows need it. npm also recommends enabling “Require two-factor authentication and disallow tokens” in the package's publishing-access settings. Do not revoke credentials shared by other packages without checking their use.

## Troubleshooting

- Confirm the owner, repository and workflow filename exactly match the npm trusted publisher.
- Confirm direct publishing is allowed, the job has `id-token: write`, and it uses a GitHub-hosted runner.
- Keep the root `package.json` repository URL pointing to `https://github.com/humanlayer/react-hotkeys-hook.git`.
- `npm whoami` and local dry runs do not verify OIDC: the token exchange happens during publication inside GitHub Actions.
- Trusted publishing does not authenticate private dependency installation. This workflow currently installs public dependencies.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), [npm trust CLI](https://docs.npmjs.com/cli/v11/commands/npm-trust).
