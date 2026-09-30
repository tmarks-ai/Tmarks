# Third-Party Notices

TMarks (`tmarks-new`) is licensed under the MIT License (see `LICENSE`).
This file records third-party material whose license terms require attribution
or notice when the repository is distributed.

## Ported code

The sync engine, snapshot capture, licensing helpers, auth flows, the
single-bookmark AI prompt/parse/fallback pipeline and the D1 schema were ported
from the earlier private repository `tmarks` — © 2024 TMarks Team, originally
published under CC BY-NC 4.0. The MIT re-license of this repository covers the
ported material **on the basis that it was authored solely by TMarks Team with
no third-party copyright contributions**. Should any third-party contribution
be identified in those modules, that portion does not re-license: it remains
under CC BY-NC 4.0 and must be removed or separately licensed before MIT
distribution of it.

## Build-tool data (does not ship in runtime bundles)

- `caniuse-lite` (via `browserslist` → `vite`) — CC-BY-4.0 browser-compatibility
  data. https://github.com/browserslist/caniuse-lite
- `lightningcss` — MPL-2.0 (Tailwind CSS v4 build chain).
- `@img/sharp-*` — Apache-2.0 AND LGPL-3.0-or-later (optional dev binary,
  not distributed with the product).

## Fonts

Both the landing page (`landing`) and the web app (`apps/web`) self-host their
fonts (`landing/public/fonts/`, `apps/web/public/fonts/`: Inter, Space Grotesk
and JetBrains Mono, latin subsets). No Google Fonts or other third-party font
requests are made at runtime. These typefaces are distributed under the SIL
Open Font License 1.1: https://openfontlicense.org