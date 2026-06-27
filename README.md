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

### Docker (recommended)

```bash
git clone https://github.com/Kruscy/padli.git
cd padli
cp .env.example .env
# Fill in at minimum: PGPASSWORD, SITE_URL, SESSION_SECRET, MAIL_*
nano .env

docker compose up -d
```

The database schema is loaded automatically on first start. Set the first admin:

```bash
docker compose exec db psql -U padli -d padli \
  -c "UPDATE users SET role='admin' WHERE email='your@email.com';"
```

### Manual install

Requires Node.js 20+, PostgreSQL 15+. See [INSTALL.md](INSTALL.md) for the full step-by-step guide including systemd and nginx configuration.

### Notes

This project is tightly coupled to specific infrastructure (Kavita library paths, Cloudflare R2, Billingo HU, Patreon, Stripe). Many integrations are optional — the core reader works without them. See `.env.example` for all available options.

## License

Source code is provided for reference. All translated content belongs to their respective authors.
