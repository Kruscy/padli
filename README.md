# PadlizsanFanSub

**A Hungarian manga & manhwa fan translation reader platform.**

Live site: [padlizsanfansub.hu](https://padlizsanfansub.hu)

---

## What is this?

PadlizsanFanSub is a full-stack web platform built for a Hungarian manga/manhwa fan translation group. It serves as both a reader for translated chapters and an internal toolset for the translation team.

## Features

### For readers
- **Manga/manhwa reader** — scroll and book (page-flip) modes, mobile swipe, keyboard navigation
- **Reading progress** — automatically saves and resumes where you left off, per chapter
- **AniList sync** — tracks your reading progress on AniList
- **Wishlist** — save titles you want to read
- **Polls** — community votes on which series to translate next
- **Leaderboard & points** — reward system for community contributors
- **Bug reports** — report translation errors or image issues directly from the reader
- **Patreon integration** — early access chapters for supporters

### For the translation team
- **PadliCrome** — in-browser AI-powered manga translation tool
  - Import chapters directly from the reader or by URL (MangaDex, WordPress-based sites)
  - Automatic machine translation of speech bubbles
  - Image stitching (merge multiple panels into one)
  - Submit fixes back to the bug report system
- **Admin panel** — manage manga, chapters, bug reports, announcements, user roles
- **Chapter uploader** — upload new chapters with automatic Kavita library sync
- **Billingo integration** — automatic invoice generation for shop purchases
- **R2/Cloudflare** — all chapter images stored on Cloudflare R2 with cache purging

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express (ES modules) |
| Database | PostgreSQL |
| Image storage | Cloudflare R2 (S3-compatible) |
| CDN | Cloudflare |
| Image processing | sharp |
| Auth | express-session + bcrypt |
| Payments | Stripe |
| Invoicing | Billingo v3 |
| AI translation | Custom ML service + OpenAI |
| OCR | Tesseract.js |
| Notifications | Discord bot (discord.js) |
| Email | Nodemailer |

## Self-hosting

This project is tightly coupled to specific infrastructure (Kavita library paths, Cloudflare R2, Billingo HU, Patreon, Stripe). It is not designed as a general-purpose self-hostable reader, but the code is open for reference and learning.

Required environment variables: see `.env.example` (not included — contact the maintainer).

## License

Source code is provided for reference. All translated content belongs to their respective authors.
