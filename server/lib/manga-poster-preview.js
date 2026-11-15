/* ── Heti manga-poszter: péntek esti Discord-előnézet (2026-11-15) ──
   Heti 2x: hétfő/péntek 19:00 → elkészül a poszter, az előnézet-csatornába (#uploaders) megy gombokkal.
   Gombok (csak Admin rang): ✅ Mehet | 🔄 Újragenerálás | 🎲 Másik mű | ⛔ Kihagyás
   Kedd/szombat 11:00 → a legutóbbi pending/approved poszt kimegy a Facebookra;
                   ha ki lett hagyva, semmi; ha nincs előnézet (pl. a gép
                   pénteken állt), a régi módon készít és kitesz egyet.
   NE importáld parancssori scriptből: a discord-bot.js importkor bejelentkezik. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { pool } from "../db.js";
import { buildWeeklyPoster, postPhotoToFacebook, runWeeklyPoster, shareToInstagram } from "./manga-poster.js";
import { onButton, isAdminMember, sendAdminMessage } from "../discord-bot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "..", "data", "posters");
const SITE = "https://padlizsanfansub.hu";
// Előnézetek csatornája (2026-11-15: #uploaders); ha nincs megadva, #riasztás
const posterChannel = () => process.env.DISCORD_POSTER_CHANNEL_ID || process.env.DISCORD_SECURITY_CHANNEL_ID;
/* A következő kitevés napja (kedd vagy szombat 11:00, Budapest) */
function nextPublishLabel() {
  const dow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Budapest" })).getDay();
  return (dow >= 3 && dow <= 6) ? "szombat 11:00-kor" : "kedd 11:00-kor";
}
let busy = false;

function buttons(id, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`poster:approve:${id}`).setLabel("Mehet").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`poster:regen:${id}`).setLabel("Újragenerálás").setEmoji("🔄").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`poster:other:${id}`).setLabel("Másik mű").setEmoji("🎲").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`poster:skip:${id}`).setLabel("Kihagyás").setEmoji("⛔").setStyle(ButtonStyle.Danger).setDisabled(disabled),
  )];
}

/* Elkészít egy előnézetet és kiküldi a Discordra. */
export async function createPreview({ slug = null, exclude = [], note = "", feedback = "" } = {}) {
  const res = await buildWeeklyPoster({ slug, exclude, feedback });
  fs.mkdirSync(DIR, { recursive: true });
  const { rows } = await pool.query(
    `INSERT INTO manga_posters (manga_id, panels, caption, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
    [res.manga.id, res.panels, res.caption]);
  const id = rows[0].id;
  const file = path.join(DIR, `${id}-${res.manga.slug}.jpg`);
  fs.writeFileSync(file, res.image);
  const msg = await sendAdminMessage({
    content: `🖼️ **Heti manga-poszter előnézet${note ? " — " + note : ""}**\n` +
      `Mű: **${res.manga.title}** (${SITE}/chapters.html?slug=${encodeURIComponent(res.manga.slug)})\n` +
      `Ha nem nyúltok hozzá, **${nextPublishLabel()}** ez megy ki a Facebookra.\n\n` +
      `**Facebook-szöveg:**\n>>> ${res.caption}`.slice(0, 1900),
    files: [{ attachment: res.image, name: `poszter-${res.manga.slug}.jpg` }],
    components: buttons(id),
  }, posterChannel());
  await pool.query("UPDATE manga_posters SET image_path = $1, discord_message_id = $2 WHERE id = $3", [file, msg.id, id]);
  console.log(`[poster] előnézet kiküldve: ${res.manga.slug} (#${id})`);
  return id;
}

async function setStatus(id, status, by) {
  await pool.query("UPDATE manga_posters SET status = $1, decided_by = $2 WHERE id = $3", [status, by, id]);
}

onButton("poster:", async (interaction) => {
  const [, action, idStr] = interaction.customId.split(":");
  const id = Number(idStr);
  if (!isAdminMember(interaction.member)) {
    return interaction.reply({ content: "❌ Ehhez Admin rang kell.", ephemeral: true });
  }
  const { rows } = await pool.query(
    "SELECT p.*, m.slug, m.title FROM manga_posters p JOIN manga m ON m.id = p.manga_id WHERE p.id = $1", [id]);
  const row = rows[0];
  if (!row || !["pending", "approved"].includes(row.status)) {
    return interaction.reply({ content: `ℹ️ Ez az előnézet már nem aktív (${row?.status || "nincs"}).`, ephemeral: true });
  }
  const who = interaction.user.username;
  const base = interaction.message.content.split("\n\n**Facebook-szöveg:**")[0];

  if (action === "approve") {
    await setStatus(id, "approved", who);
    return interaction.update({ content: interaction.message.content.replace(base, base + `\n✅ **Jóváhagyta: ${who}** — ${nextPublishLabel()} kimegy.`).slice(0, 2000), components: buttons(id) });
  }
  if (action === "skip") {
    await setStatus(id, "skipped", who);
    return interaction.update({ content: (base + `\n⛔ **Kihagyva (${who})** — ezen a héten nem megy ki manga-poszter.`).slice(0, 2000), components: buttons(id, true) });
  }
  if (action === "regen" || action === "other") {
    if (busy) return interaction.reply({ content: "⏳ Épp készül egy poszter, várj egy kicsit.", ephemeral: true });
    busy = true;
    await interaction.update({ content: (base + `\n⏳ **${who}: ${action === "regen" ? "újragenerálás ugyanebből a műből" : "másik mű választása"}…** (1–2 perc)`).slice(0, 2000), components: buttons(id, true) });
    try {
      await setStatus(id, "replaced", who);
      await createPreview(action === "regen"
        ? { slug: row.slug, note: `újragenerálva (${who})` }
        : { exclude: [row.slug], note: `másik mű (${who})` });
      await interaction.message.edit({ content: (base + `\n↪️ Lecserélve (${who}) — lásd az új előnézetet lent.`).slice(0, 2000), components: buttons(id, true) });
    } catch (e) {
      await setStatus(id, "pending", null);
      await interaction.message.edit({ content: (base + `\n❌ Nem sikerült újat készíteni: ${e.message.slice(0, 200)} — ez marad érvényben.`).slice(0, 2000), components: buttons(id) });
    } finally { busy = false; }
  }
});

/* Kedd/szombat: a legfrissebb (2 napon belüli) döntés szerint posztol. */
export async function publishWeekly() {
  // Védelem: ha 2 napon belül már kiment egy (pl. kézzel), most nem
  const recent = await pool.query(
    "SELECT 1 FROM manga_posters WHERE status = 'posted' AND created_at > now() - interval '2 days' LIMIT 1");
  if (recent.rows.length) { console.log("[poster] 2 napon belül már volt poszt, most kihagyva"); return null; }
  const { rows } = await pool.query(
    `SELECT p.*, m.slug FROM manga_posters p JOIN manga m ON m.id = p.manga_id
      WHERE p.status IN ('pending','approved','skipped') AND p.created_at > now() - interval '2 days'
      ORDER BY p.id DESC LIMIT 1`);
  const row = rows[0];
  if (row?.status === "skipped") { console.log("[poster] ez a poszter kihagyva"); return null; }
  if (row && row.image_path && fs.existsSync(row.image_path)) {
    const image = fs.readFileSync(row.image_path);
    const fbId = await postPhotoToFacebook(image, row.caption);
    await pool.query("UPDATE manga_posters SET status = 'posted', fb_post_id = $1 WHERE id = $2", [fbId, row.id]);
    const ig = await shareToInstagram(row.id, image, row.caption, row.slug);
    const igLine = !ig ? "" : ig.error ? `\n⚠️ Instagram: nem sikerült (${ig.error.slice(0, 150)})` : `\n📸 Instagram: ${ig.permalink || "kint van"}`;
    await sendAdminMessage({ content: `✅ Heti manga-poszter kiment: **${row.slug}** → https://www.facebook.com/${fbId.replace("_", "/posts/")}${igLine}` }, posterChannel()).catch(() => {});
    console.log(`[poster] kiposztolva (előnézetből): ${row.slug} → ${fbId}`);
    return fbId;
  }
  // Nincs előnézet: a régi módon
  const res = await runWeeklyPoster({ post: true });
  await sendAdminMessage({ content: `✅ Heti manga-poszter kiment (előnézet nélkül készült): **${res.manga.slug}**${res.ig?.permalink ? "\n📸 Instagram: " + res.ig.permalink : res.ig?.error ? "\n⚠️ Instagram: nem sikerült" : ""}` }, posterChannel()).catch(() => {});
  return res.fbId;
}
