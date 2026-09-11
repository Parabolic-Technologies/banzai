# Banzai logo

The emblem is three interlocking angular ribbon segments advancing to the upper
right: one silhouette made of three coordinated parts, the way a Banzai run is
one workflow carried by a planner, an implementer, and an independent reviewer.
It is a single-colour vermilion mark on a dark navy tile, drawn as clean vector
geometry with a shared diagonal and softened outer corners.

## Files

| File                        | Use                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `banzai-mark.svg`           | Square emblem, transparent background, single colour. Favicons, app icons, badges.                    |
| `banzai-mark-256.png`       | Transparent PNG export of the emblem for places that cannot take SVG.                                 |
| `banzai-logo.svg`           | Horizontal lockup (emblem, wordmark, tagline). Adapts to the viewer's colour scheme via embedded CSS. |
| `banzai-logo-light.svg`     | Lockup with fixed navy text, for light backgrounds.                                                   |
| `banzai-logo-dark.svg`      | Lockup with fixed light text, for dark backgrounds.                                                   |
| `banzai-avatar-512.png`     | Square navy tile for the GitHub organisation or repository avatar.                                    |
| `banzai-avatar-192.png`     | Same tile at 192 px for marketplaces and plugin listings.                                             |
| `banzai-avatar.svg`         | Editable source of the avatar tile.                                                                   |
| `banzai-social-preview.png` | 1280×640 card for the GitHub repository social preview and link unfurls.                              |
| `banzai-social-preview.svg` | Editable source of the social preview card.                                                           |

The vector emblem in `banzai-mark.svg` is the canonical editable source. It was
traced from the earlier raster concept, with its edges regularised to one shared
diagonal slope and horizontal or vertical cuts.

## Where each asset goes

- GitHub repository: Settings → General → Social preview → upload
  `banzai-social-preview.png`.
- GitHub organisation or user avatar: upload `banzai-avatar-512.png`.
- README header: the root `README.md` uses a `<picture>` element that picks
  the dark or light lockup and falls back to the adaptive `banzai-logo.svg`.

## Colours

| Role                   | Hex       |
| ---------------------- | --------- |
| Vermilion (emblem)     | `#FF5A3C` |
| Navy (tiles, cards)    | `#0B1526` |
| Navy ink (text, light) | `#0F1B2D` |
| Paper (text, dark)     | `#F4F5F7` |
| Muted tagline, light   | `#5B6577` |
| Muted tagline, dark    | `#A3ACBA` |

## Type

The wordmark is set in Sora Bold and the tagline in Inter Medium with 20%
tracking. Both fonts are published under the SIL Open Font License. The glyphs
are embedded as outlines, so no font needs to be installed to render the files.
See [third-party information](../../THIRD_PARTY_NOTICES.md) for attribution
and [Names and Logos](../../TRADEMARKS.md) for trademark scope. Original artwork
is covered by the repository's [Apache-2.0 license](../../LICENSE).

## Usage notes

- Keep clear space around the emblem of at least a quarter of its width.
- The emblem is one colour. On dark surfaces use vermilion on navy; on light
  surfaces vermilion sits directly on the page, as in the lockups.
- Do not place the emblem on vermilion, red, or orange backgrounds.
- The emblem stays legible down to 16 px; below 32 px prefer the emblem alone
  over the lockup.
- Do not rotate, skew, outline, or add gradients or shadows.
