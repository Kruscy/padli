/* ── Instagram lapozós részlet: Discord-előnézet + közzététel (2026-11-15) ──
   H/Sze/P 20:00 → előnézet az előnézet-csatornába (#uploaders) gombokkal
   (✅ Mehet | 🔄 Másik jelenet | 🎲 Másik mű | ⛔ Kihagyás, csak Admin).
   K/Cs/Szo 18:00 → a legutóbbi (2 napon belüli) előnézet kimegy az Instagramra;
   ha ki lett hagyva, semmi; ha nincs előnézet, előnézet nélkül készül egy.
   NE importáld parancssori scriptből: a discord-bot.js importkor bejelentkezik. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { pool } from "../db.js";
import { buildSnippet } from "./ig-snippet.js";
import { postCarouselToInstagram, instagramConfigured } from "./instagram.js";
import { onButton, isAdminMember, sendAdminMessage } from "../discord-bot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "..", "data", "snippets");
const SITE = "https://padlizsanfansub.hu";
const channel = () => process.env.DISCORD_POSTER_CHANNEL_ID || process.env.DISCORD_SECURITY_CHANNEL_ID;
let busy = false;

function nextPublishLabel() {
  const dow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Budapest" })).getDay();
  return ({ 0: "kedd", 1: "kedd", 2: "csütörtök", 3: "csütörtök", 4: "szombat", 5: "szombat", 6: "kedd" })[dow] + " 18:00-kor";
}

function buttons(id, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`snip:approve:${id}`).setLabel("Mehet").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`snip:regen:${id}`).setLabel("Másik jelenet").setEmoji("🔄").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`snip:other:${id}`).setLabel("Másik mű").setEmoji("🎲").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`snip:skip:${id}`).setLabel("Kihagyás").setEmoji("⛔").setStyle(ButtonStyle.Danger).setDisabled(disabled),
  )];
}

async function saveSnippet(res, status) {
  const { rows } = await pool.query(
    `INSERT INTO ig_snippets (manga_id, panels, caption, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [res.manga.id, res.panels, res.caption, status]);
  const id = rows[0].id;
  fs.mkdirSync(DIR, { recursive: true });
  const paths = res.slides.map((b, i) => {
    const f = path.join(DIR, `${id}-${res.manga.slug}-${i + 1}.jpg`);
    fs.writeFileSync(f, b);
    return f;
  });
  await pool.query("UPDATE ig_snippets SET image_paths = $1 WHERE id = $2", [paths, id]);
  return id;
}

export async function createSnippetPreview({ slug = null, exclude = [], avoid = [], note = "" } = {}) {
  const res = await buildSnippet({ slug, exclude, avoid });
  const id = await saveSnippet(res, "pending");
  const msg = await sendAdminMessage({
    content: (`📸 **Instagram lapozós részlet — előnézet${note ? " — " + note : ""}**\n` +
      `Mű: **${res.manga.title}** (${SITE}/chapters.html?slug=${encodeURIComponent(res.manga.slug)})\n` +
      `${res.slides.length} dia, ebben a sorrendben. Ha nem nyúltok hozzá, **${nextPublishLabel()}** kimegy az Instagramra.\n\n` +
      `**Instagram-szöveg:**\n>>> ${res.caption}`).slice(0, 1900),
    files: res.slides.map((b, i) => ({ attachment: b, name: `dia-${i + 1}.jpg` })),
    components: buttons(id),
  }, channel());
  await pool.query("UPDATE ig_snippets SET discord_message_id = $1 WHERE id = $2", [msg.id, id]);
  console.log(`[ig-snippet] előnézet kiküldve: ${res.manga.slug} (#${id})`);
  return id;
}

async function setStatus(id, status, by) {
  await pool.query("UPDATE ig_snippets SET status = $1, decided_by = $2 WHERE id = $3", [status, by, id]);
}

onButton("snip:", async (interaction) => {
  const [, action, idStr] = interaction.customId.split(":");
  const id = Number(idStr);
  if (!isAdminMember(interaction.member)) {
    return interaction.reply({ content: "❌ Ehhez Admin rang kell.", ephemeral: true });
  }
  const { rows } = await pool.query(
    "SELECT s.*, m.slug FROM ig_snippets s JOIN manga m ON m.id = s.manga_id WHERE s.id = $1", [id]);
  const row = rows[0];
  if (!row || !["pending", "approved"].includes(row.status)) {
    return interaction.reply({ content: `ℹ️ Ez az előnézet már nem aktív (${row?.status || "nincs"}).`, ephemeral: true });
  }
  const who = interaction.user.username;
  const base = interaction.message.content.split("\n\n**Instagram-szöveg:**")[0];

  if (action === "approve") {
    await setStatus(id, "approved", who);
    return interaction.update({ content: interaction.message.content.replace(base, base + `\n✅ **Jóváhagyta: ${who}** — ${nextPublishLabel()} kimegy.`).slice(0, 2000), components: buttons(id) });
  }
  if (action === "skip") {
    await setStatus(id, "skipped", who);
    return interaction.update({ content: (base + `\n⛔ **Kihagyva (${who})** — ez a részlet nem megy ki.`).slice(0, 2000), components: buttons(id, true) });
  }
  if (action === "regen" || action === "other") {
    if (busy) return interaction.reply({ content: "⏳ Épp készül egy részlet, várj egy kicsit.", ephemeral: true });
    busy = true;
    await interaction.update({ content: (base + `\n⏳ **${who}: ${action === "regen" ? "másik jelenet ugyanebből a műből" : "másik mű választása"}…** (1–2 perc)`).slice(0, 2000), components: buttons(id, true) });
    try {
      await setStatus(id, "replaced", who);
      await createSnippetPreview(action === "regen"
        ? { slug: row.slug, avoid: row.panels || [], note: `másik jelenet (${who})` }
        : { exclude: [row.slug], note: `másik mű (${who})` });
      await interaction.message.edit({ content: (base + `\n↪️ Lecserélve (${who}) — lásd az új előnézetet lent.`).slice(0, 2000), components: buttons(id, true) });
    } catch (e) {
      await setStatus(id, "pending", null);
      await interaction.message.edit({ content: (base + `\n❌ Nem sikerült újat készíteni: ${e.message.slice(0, 200)} — ez marad érvényben.`).slice(0, 2000), components: buttons(id) });
    } finally { busy = false; }
  }
});

/* K/Cs/Szo 18:00: a legfrissebb (2 napon belüli) döntés szerint posztol. */
export async function publishSnippet() {
  if (!instagramConfigured()) return null;
  const recent = await pool.query(
    "SELECT 1 FROM ig_snippets WHERE status = 'posted' AND created_at > now() - interval '20 hours' LIMIT 1");
  if (recent.rows.length) { console.log("[ig-snippet] nemrég már volt, most kihagyva"); return null; }
  const { rows } = await pool.query(
    `SELECT s.*, m.slug FROM ig_snippets s JOIN manga m ON m.id = s.manga_id
      WHERE s.status IN ('pending','approved','skipped') AND s.created_at > now() - interval '2 days'
      ORDER BY s.id DESC LIMIT 1`);
  let row = rows[0];
  if (row?.status === "skipped") { console.log("[ig-snippet] kihagyva"); return null; }
  let images;
  if (row && row.image_paths?.length && row.image_paths.every(f => fs.existsSync(f))) {
    images = row.image_paths.map(f => fs.readFileSync(f));
  } else {
    const res = await buildSnippet();
    const id = await saveSnippet(res, "pending");
    row = { id, slug: res.manga.slug, caption: res.caption };
    images = res.slides;
  }
  try {
    const ig = await postCarouselToInstagram(images, row.caption, `snippet-${row.id}-${row.slug}`);
    await pool.query("UPDATE ig_snippets SET status = 'posted', ig_media_id = $1, ig_permalink = $2 WHERE id = $3", [ig.id, ig.permalink, row.id]);
    await sendAdminMessage({ content: `📸 Instagram lapozós részlet kiment: **${row.slug}** → ${ig.permalink || ig.id}` }, channel()).catch(() => {});
    console.log(`[ig-snippet] kiposztolva: ${row.slug} → ${ig.permalink || ig.id}`);
    return ig;
  } catch (e) {
    await pool.query("UPDATE ig_snippets SET error = $1 WHERE id = $2", [e.message.slice(0, 500), row.id]).catch(() => {});
    await sendAdminMessage({ content: `⚠️ Instagram lapozós részlet NEM ment ki (**${row.slug}**): ${e.message.slice(0, 300)}` }, channel()).catch(() => {});
    throw e;
  }
}
