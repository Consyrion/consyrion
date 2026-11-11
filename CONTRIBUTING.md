# Contributing

Thanks for helping. CONSYRIUM AI is licensed under AGPL-3.0; by contributing you agree that your contribution is
released under the same license.

1. Open an issue first for larger changes, so the approach can be agreed before you build it.
2. Work on a branch, keep changes focused, and document new features in README/docs in the same pull request.
3. Before opening a pull request run `pnpm lint && pnpm typecheck && pnpm test` (and `pnpm build` for UI changes).
4. Format only the files you change: `pnpm format <files>`.

Rules that keep the product honest are in [CLAUDE.md](CLAUDE.md) – in short: BYOK only, no invented data, provider
keys never leave the server in plaintext, generated code only runs in the sandbox, every tenant query goes through a
repository with a permission check.
