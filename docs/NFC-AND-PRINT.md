# NFC tap cards & print

## Make a tap-to-share card (like Popl / Wave)

1. Buy blank **NTAG215** (or NTAG213/216) NFC cards, stickers or keychains. They cost about $0.50–$1 each in bulk.
2. Install **NFC Tools** (iOS / Android, free).
3. *Write → Add a record → URL/URI* → paste your card URL (`https://<user>.github.io/<repo>/`) → *Write* → hold the tag to your phone.
4. Optional: *Other → Lock tag* so it can't be overwritten. **Locking is permanent**, so only lock it once the URL is final.

Any modern iPhone or Android phone opens the link with a tap. No app is needed.

> Tip: because the URL never changes, you can edit `card.json` forever and every tag/QR you've handed out stays current.

## QR for print

Each deploy publishes:
- `https://…/qr.svg`: vector, for posters, badges and slides
- `https://…/qr.png`: 1024 px raster

Leave a quiet zone around the code at least 4 modules wide, and print it at least 2 cm / 0.8 in wide.

## Physical card layout (suggested)

Standard CR80 card: 85.6 × 54 mm.
- **Front:** name, title, *UGA GSA Connect*, small *Powered by ScholarTap*
- **Back:** QR code + short URL + a "Tap or scan" icon
- Embed the NFC inlay behind the back face (or use a pre-encoded PVC NFC card)
