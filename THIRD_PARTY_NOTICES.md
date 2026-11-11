# Third-party notices

CONSYRIUM AI is licensed under the AGPL-3.0. It ships the following third-party material under its own licence.

| Component | Where | Licence | Use |
|---|---|---|---|
| Noto Sans SC (Regular), © Google / Adobe, from [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) | `apps/web/public/fonts/NotoSansSC-Regular.otf` | SIL Open Font License 1.1 – full text in `apps/web/public/fonts/NotoSansSC-OFL.txt` | Chinese PDF reports (#268): loaded only for zh, embedded as a subset of the characters used |
| `@pdf-lib/fontkit` | npm dependency of `apps/web` | MIT | Embedding the font above into PDFs |

npm dependencies are listed with their licences in each package's `package.json` and lock file.
