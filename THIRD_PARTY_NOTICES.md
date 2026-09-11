# Third-Party Information

Banzai's [Apache-2.0 license](LICENSE) does not replace licenses for third-party
software or other material. Preserve the relevant licenses and notices when
redistributing those components.

## JavaScript dependencies

The exact dependency versions and their recorded license identifiers are in
[package-lock.json](package-lock.json). The orchestrator directly depends on
`@inquirer/core` and `@inquirer/prompts`, both published under the MIT License
by the [Inquirer project](https://github.com/SBoudrias/Inquirer.js). Their
transitive dependencies and the development toolchain retain their own licenses.

The committed CLI build uses esbuild's `packages: "external"`: npm packages
are installed separately and are not incorporated into `dist/banzai.mjs` or
its source map. This source distribution does not ship `node_modules`.
The build tool itself is not part of the CLI bundle.

This document is an attribution guide, not a replacement for dependency
license texts. If you distribute installed dependencies or introduce a bundle
that embeds them, include the applicable license texts and notices from those
packages and review the resulting distribution again.

## Typography in the logo artwork

The wordmark and tagline use outlined glyphs from:

- **Sora** — Copyright 2019 The Sora Project Authors.
  [Project and license](https://github.com/sora-xor/sora-font/blob/master/OFL.txt).
- **Inter** — Copyright 2016 The Inter Project Authors.
  [Project and license](https://github.com/rsms/inter/blob/master/LICENSE.txt).

Both font projects use the SIL Open Font License, Version 1.1. Banzai includes
logo artwork made with the fonts, not standalone font software. The
[OFL FAQ, sections 1.1–1.1.2](https://openfontlicense.org/ofl-faq/) explains
that this kind of artwork does not inherit the font license or require
attribution; these acknowledgments are provided voluntarily.

See [the asset inventory](assets/logo/README.md) and
[the names and logos policy](TRADEMARKS.md). If font software is added later,
its copyright and full OFL license must accompany that distribution.

## External tools and services

Git, Node.js, npm, Codex, and Claude Code are separate tools with their own
licenses or terms. Naming or integrating with them does not relicense them,
grant a subscription, or imply endorsement by their authors or providers.
