# eBay API Notes

## Active Listings

Use the official Browse API item summary search:

```text
GET https://api.ebay.com/buy/browse/v1/item_summary/search
```

Headers:

```text
Authorization: Bearer <app-token>
X-EBAY-C-MARKETPLACE-ID: EBAY_GB
```

Useful query parameters:

- `q`: lens search term.
- `limit`: result page size.
- `filter`: price, currency, buying option, condition, and other Browse filters.
- `fieldgroups=EXTENDED`: includes short descriptions and extra location fields where available.

## Sold Comparables

Preferred source is Marketplace Insights/Product Research where account access is approved. The v1 code intentionally keeps this behind `SoldCompCollector` so implementation can be swapped without changing valuation/scoring.

## Credential Handling

Use app credentials through `.env`; never store production keys in committed files. Rotate a client secret if it appears in chat, source control, logs, or screenshots.
