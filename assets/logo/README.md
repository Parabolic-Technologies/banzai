# Banzai logo

The Banzai asset family uses the supplied Parabolic colour icon: a white symbol
on a rounded tile with a blue-to-magenta gradient. Horizontal lockups retain the
original Banzai wordmark and "Spec-Driven AI Development" tagline. The social
preview also retains "for Claude Code and Codex".

## Files

| File                        | Use                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `banzai-mark.svg`           | 256×256 Parabolic icon, transparent outside the rounded tile. Favicons, app icons, badges.       |
| `banzai-mark-256.png`       | 256×256 PNG export of the icon, retaining transparent corners.                                   |
| `banzai-logo.svg`           | Horizontal lockup with Parabolic icon; wordmark and tagline adapt to the viewer's colour scheme. |
| `banzai-logo-light.svg`     | Horizontal lockup with fixed navy wordmark and muted tagline, for light backgrounds.             |
| `banzai-logo-dark.svg`      | Horizontal lockup with fixed light wordmark and muted tagline, for dark backgrounds.             |
| `banzai-avatar-512.png`     | 512×512 navy tile with a centred Parabolic icon, for GitHub organisation or repository avatars.  |
| `banzai-avatar-192.png`     | 192×192 export of the same avatar, for marketplaces and plugin listings.                         |
| `banzai-avatar.svg`         | 512×512 editable source of the avatar tile.                                                      |
| `banzai-social-preview.png` | 1280×640 navy card with the Parabolic icon, original lettering and a matching gradient accent.   |
| `banzai-social-preview.svg` | 1280×640 editable source of the social preview card.                                             |

The standalone icon in `banzai-mark.svg` is the canonical editable source. Each
SVG embeds the supplied `Parabolic-Icon-Color.svg` artwork with proportional
scaling, including its gradient, white paths and embedded shadow images. All
assets are self-contained. PNG files are rendered from the corresponding SVG
at the dimensions listed above.

## Where each asset goes

- GitHub repository: Settings → General → Social preview → upload
  `banzai-social-preview.png`.
- GitHub organisation or user avatar: upload `banzai-avatar-512.png`.
- README headers: the root and orchestrator `README.md` files use a `<picture>`
  element that picks the light or dark lockup and falls back to the adaptive
  `banzai-logo.svg`.

## Colours

| Role                       | Hex       |
| -------------------------- | --------- |
| Icon gradient, deep navy   | `#0F142E` |
| Icon gradient, navy        | `#142C79` |
| Icon gradient, blue        | `#1538AB` |
| Icon gradient, violet      | `#8706F7` |
| Icon gradient, magenta     | `#FF00FF` |
| Icon symbol                | `#FFFFFF` |
| Navy (avatar, social card) | `#0B1526` |
| Navy ink (text, light)     | `#0F1B2D` |
| Paper (text, dark)         | `#F4F5F7` |
| Muted tagline, light       | `#5B6577` |
| Muted tagline, dark        | `#A3ACBA` |

## Type

The wordmark is set in Sora Bold and the tagline in Inter Medium with 20%
tracking. Both fonts are published under the SIL Open Font License. The glyphs
are embedded as outlines, so no font needs to be installed to render the files.
See [third-party information](../../THIRD_PARTY_NOTICES.md) for attribution
and [Names and Logos](../../TRADEMARKS.md) for trademark scope. Original artwork
is covered by the repository's [Apache-2.0 license](../../LICENSE).

## Usage notes

- Preserve the supplied icon's proportions, gradient, white symbol and shadows.
- Keep clear space around the icon; use the prepared avatar files when a square
  opaque background is required.
- Choose the light or dark lockup to keep the lettering legible. The adaptive
  lockup changes text colours only; the Parabolic icon stays the same.
- Use the standalone icon for small placements instead of shrinking the full
  lockup until its tagline becomes unreadable.
- Do not rotate, skew, recolour, outline or add effects to the supplied artwork.
