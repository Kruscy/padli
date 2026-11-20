/* ── #media csatorna: szöveges admin-visszajelzés az előnézetekre (2026-11-15) ──
   Ha egy Admin ír a médiás csatornába (válaszként egy előnézetre, vagy simán — akkor a
   legutóbbi aktív előnézetre vonatkozik), az AI értelmezi:
     regen   → ugyanabból a műből új változat, a kérés figyelembevételével
     other   → másik mű
     approve → jóváhagyás, skip → kihagyás, none → nem kérés (csak beszélgetés)
   Az általánosítható tanulságot (pl. „ne legyen dia, amin csak egy tárgy van”) elmenti, és
   a későbbi válogatásoknál is megkapja az AI (social_feedback → recentFeedback).
   NE importáld parancssori scriptből (discord-bot.js). */
import { pool } from "../db.js";
import { assertSocialEnabled, socialDisabled } from "./social-switch.js";
import { onMessage, isAdminMember } from "../discord-bot.js";
import { openaiJson } from "./manga-poster.js";
import { createSnippetPreview } from "./ig-snippet-preview.js";
import { createPreview } from "./manga-poster-preview.js";

const channelId = () => process.env.DISCORD_POSTER_CHANNEL_ID;
let busy = false;

async function findTarget(msg) {
  const ref = msg.reference?.messageId;
  if (ref) {
    const s = await pool.query("SELECT s.*, m.slug, m.title FROM ig_snippets s JOIN manga m ON m.id = s.manga_id WHERE s.discord_message_id = $1", [ref]);
    if (s.rows[0]) return { kind: "snippet", row: s.rows[0] };
    const p = await pool.query("SELECT p.*, m.slug, m.title FROM manga_posters p JOIN manga m ON m.id = p.manga_id WHERE p.discord_message_id = $1", [ref]);
    if (p.rows[0]) return { kind: "poster", row: p.rows[0] };
  }
  const { rows } = await pool.query(`
    SELECT * FROM (
      SELECT 'snippet' AS kind, s.id, s.created_at FROM ig_snippets s
       WHERE s.status IN ('pending','approved') AND s.discord_message_id IS NOT NULL AND s.created_at > now() - interval '2 days'
      UNION ALL
      SELECT 'poster', p.id, p.created_at FROM manga_posters p
       WHERE p.status IN ('pending','approved') AND p.discord_message_id IS NOT NULL AND p.created_at > now() - interval '3 days'
    ) x ORDER BY created_at DESC LIMIT 1`);
  if (!rows[0]) return null;
  const tbl = rows[0].kind === "snippet" ? "ig_snippets" : "manga_posters";
  const r = await pool.query(`SELECT t.*, m.slug, m.title FROM ${tbl} t JOIN manga m ON m.id = t.manga_id WHERE t.id = $1`, [rows[0].id]);
  return r.rows[0] ? { kind: rows[0].kind, row: r.rows[0] } : null;
}

async function interpret(text, target) {
  const what = target.kind === "snippet" ? "Instagram/TikTok lapozós részlet (egymást követő képkockák diákon)" : "Facebook manga-ajánló kollázs-poszter";
  return openaiJson("gpt-4o-mini", [{ type: "text", text:
`Egy admin ezt írta egy ${what} előnézetére (mű: ${target.row.title}):
"""${text.slice(0, 1000)}"""
Döntsd el, mit kér:
- "regen": ugyanabból a műből másik változatot / javítást (pl. rossz kockák, kép nem jó)
- "other": másik művet
- "approve": jó így, mehet
- "skip": ne menjen ki
- "none": nem az előnézetről szól, csak beszélgetés
"now": a mostani újrakészítéshez a kérés tömören, az AI-nak szóló utasításként (magyarul), pl. "Az első két dia rossz volt: az egyiken csak egy kard, a másikon félbevágott arc látszott — ne ilyet válassz."
"rule": ha van belőle ÁLTALÁNOS, későbbi posztokra is érvényes tanulság, egy rövid szabályként (pl. "Ne legyen olyan dia, amin csak egy tárgy látszik."), különben "".
Válasz CSAK JSON: {"action":"...","now":"...","rule":"..."}` }], 300);
}

async function editOld(msg, row, line) {
  try {
    const old = await msg.channel.messages.fetch(row.discord_message_id);
    const marker = old.content.includes("**Instagram-szöveg:**") ? "\n\n**Instagram-szöveg:**" : "\n\n**Facebook-szöveg:**";
    const base = old.content.split(marker)[0];
    await old.edit({ content: (base + "\n" + line).slice(0, 2000), components: [] });
  } catch (e) { console.warn("[feedback] régi üzenet szerkesztése:", e.message); }
}

onMessage(async (msg) => {
  if (socialDisabled()) return;
  if (!channelId() || msg.channelId !== channelId()) return;
  if (!msg.content?.trim() || !isAdminMember(msg.member)) return;
  const target = await findTarget(msg);
  if (!target) return;
  let out;
  try { out = await interpret(msg.content, target); }
  catch (e) { console.warn("[feedback] értelmezés:", e.message); return; }
  const action = String(out.action || "none");
  if (action === "none") return;
  const who = msg.author.username;
  const tbl = target.kind === "snippet" ? "ig_snippets" : "manga_posters";
  await pool.query("INSERT INTO social_feedback (kind, target_id, author, message, instruction) VALUES ($1, $2, $3, $4, $5)",
    [target.kind, target.row.id, who, msg.content.slice(0, 2000), String(out.rule || "").slice(0, 300) || null]).catch(() => {});

  if (action === "approve" || action === "skip") {
    await pool.query(`UPDATE ${tbl} SET status = $1, decided_by = $2 WHERE id = $3`, [action === "approve" ? "approved" : "skipped", who, target.row.id]);
    await msg.reply(action === "approve" ? `✅ Rendben, **${target.row.title}** jóváhagyva.` : `⛔ Rendben, **${target.row.title}** nem megy ki.`);
    if (action === "skip") await editOld(msg, target.row, `⛔ **Kihagyva (${who}, üzenetben)**`);
    return;
  }
  if (busy) { await msg.reply("⏳ Épp készül egy új változat, várj egy kicsit, utána írd újra."); return; }
  busy = true;
  await msg.react("⏳").catch(() => {});
  await msg.reply(`🔄 Értem: _${String(out.now || msg.content).slice(0, 300)}_\nKészítem az új változatot ${action === "other" ? "egy másik műből" : `a **${target.row.title}** műből`} (1–2 perc).${out.rule ? `\n📝 Megjegyeztem a későbbiekre is: _${out.rule}_` : ""}`).catch(() => {});
  try {
    await pool.query(`UPDATE ${tbl} SET status = 'replaced', decided_by = $1 WHERE id = $2`, [who, target.row.id]);
    const note = `${who} kérésére`;
    if (target.kind === "snippet") {
      await createSnippetPreview(action === "other"
        ? { exclude: [target.row.slug], note, feedback: out.now }
        : { slug: target.row.slug, avoid: target.row.panels || [], note, feedback: out.now });
    } else {
      await createPreview(action === "other"
        ? { exclude: [target.row.slug], note, feedback: out.now }
        : { slug: target.row.slug, note, feedback: out.now });
    }
    await editOld(msg, target.row, `↪️ Lecserélve (${who} üzenete alapján) — lásd az új előnézetet lent.`);
  } catch (e) {
    await pool.query(`UPDATE ${tbl} SET status = 'pending', decided_by = NULL WHERE id = $1`, [target.row.id]).catch(() => {});
    await msg.reply(`❌ Nem sikerült új változatot készíteni: ${e.message.slice(0, 200)} — a régi marad érvényben.`).catch(() => {});
  } finally {
    busy = false;
    await msg.reactions.cache.get("⏳")?.users.remove(msg.client.user.id).catch(() => {});
  }
});

console.log("[feedback] #media visszajelzés-figyelő aktív");
