# Design-system font sources

These are the unchanged WOFF2 bytes at the URLs in `../fonts.json`, plus each
family's actual SIL Open Font License from the Google Fonts source repository.
`sources.json` records each original URL, family, filename, SHA-256 digest and
upstream license URL. Review source and license changes when updating fonts.

`npm run generate:design-systems -- fonts` is the explicit network maintenance
command that updates these sources. Commit its outputs. Normal installation,
builds and offline exports never download fonts: `copy-assets.mjs` verifies these
bytes and licenses, then copies them into the shared content-addressed `/fonts`
catalog. The same generated manifest resolves design-system CSS for hosted and
local rendering; both existing offline exporters inline those local assets.

A missing source, changed checksum or invalid WOFF2/license fails asset generation.
