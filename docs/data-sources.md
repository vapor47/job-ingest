# Third-party data sources

## GeoNames (location taxonomy)

`data/geo/locations.json` (JOS-63) is built from [GeoNames](https://www.geonames.org)
(`cities15000`, `admin1CodesASCII`, `countryInfo`, `alternateNamesV2`), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution per the license:

> This product includes GeoNames data, © GeoNames, licensed under CC BY 4.0.

Regenerate with `node scripts/import-geonames.ts`; see that script's comments for the
hierarchy and alias-scope decisions (JOS-63).
