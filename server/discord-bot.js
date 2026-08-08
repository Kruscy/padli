import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { WebSocketServer } from "ws";
import { pool } from "./db.js";
import { handleChatMessageForAI } from "./padli-ai.js";

const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;

/* ── ROLE KEZELÉS (admin/mod slash parancsok) ──────────────
   A bot csak a saját szerepköre ALATT lévő rangokat tudja kezelni
   (Discord hierarchia-szabály), és ehhez "Manage Roles" jogosultság
   kell neki a szerveren — ezt a szerver beállításaiban kell megadni,
   kódból nem lehet. A parancsokat a server/scripts/register-role-
   commands.mjs regisztrálja (egyszeri, kézi futtatás). ── */
const MANAGEABLE_ROLES = {
  "Tag": "1382774697745191004",
  "Támogató": "1415980189879632003",
  "Booster": "1415980376039493804",
  "Szuper Támogató": "1415980701316022322",
  "Hentai": "1518335431475728537",
};
const ADMIN_ROLE_ID = "1382774504412938320";
const MOD_ROLE_ID = "1382765977522929676";

/* ── FELTÖRT FIÓK / RAID VÉDELEM ───────────────────────────
   Ha egy user rövid időn belül sok csatornán, sok tag-eléssel
   (és/vagy képekkel) posztol, az gyanús mintázat (valószínűleg
   feltört fiók tömeges spam-je) — ilyenkor töröljük az adott
   ablakban küldött üzeneteit és kirúgjuk (nem bannoljuk, hogy
   vissza tudjon térni, ha rendbe tette a fiókját). Ehhez a
   botnak "Kick Members" ÉS "Manage Messages" jogosultság is
   kell a szerveren (a "Manage Roles" mellett). ── */
const RAID_WINDOW_MS = 10000;
const RAID_MIN_CHANNELS = 3;
const RAID_MIN_MENTIONS_TOTAL = 8;
const RAID_MIN_MESSAGES_WITH_IMAGES = 5;
const userActivity = new Map();

async function handleCompromisedAccount(guild, user, messages) {
  console.log(`🚨 Feltört fiók gyanú: ${user.tag} (${user.id}) — ${messages.length} üzenet törlése és kick`);

  const byChannel = {};
  for (const m of messages) {
    (byChannel[m.channelId] ||= []).push(m.messageId);
  }
  for (const [channelId, messageIds] of Object.entries(byChannel)) {
    try {
      const channel = await guild.channels.fetch(channelId);
      for (const id of messageIds) {
        await channel.messages.delete(id).catch(() => {});
      }
    } catch (err) {
      console.error(`Üzenet törlési hiba (${channelId}):`, err.message);
    }
  }

  try {
    const member = await guild.members.fetch(user.id);
    await member.kick("Automatikus védelem: gyanús tömeges tag-elés / spam minta (valószínűleg feltört fiók)");
  } catch (err) {
    console.error("Kick hiba:", err.message);
  }

  try {
    const logChannel = await guild.channels.fetch(CHANNEL_ID);
    await logChannel.send(`🚨 **Automatikus védelem aktiválva**: ${user.tag} (${user.id}) fiókja gyanúsan viselkedett (tömeges tag-elés/spam több csatornán) — kirúgva, üzenetei törölve. Ha ez tévedés volt, az illető visszahívható.`);
  } catch {}

  userActivity.delete(user.id);
}

// WebSocket szerver a klienseknek

const wss = new WebSocketServer({ port: parseInt(process.env.WS_PORT || "3001") });
const clients = new Set();

wss.on("connection", ws => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(msg);
  });
}
export { broadcast };
// Discord bot
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

bot.once("ready", () => {
  console.log(`✅ Discord bot ready: ${bot.user.tag}`);
});

// Discord → Web
bot.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  // Feltört fiók / raid detektálás — bármelyik csatornán, minden üzenetnél.
  if (msg.guild) {
    const activity = userActivity.get(msg.author.id) || { messages: [], flagged: false };
    activity.messages = activity.messages.filter(m => Date.now() - m.ts < RAID_WINDOW_MS);
    activity.messages.push({
      channelId: msg.channelId,
      messageId: msg.id,
      mentionCount: msg.mentions.users.size + msg.mentions.roles.size + (msg.mentions.everyone ? 50 : 0),
      hasAttachment: msg.attachments.size > 0,
      ts: Date.now(),
    });
    userActivity.set(msg.author.id, activity);

    const distinctChannels = new Set(activity.messages.map(m => m.channelId)).size;
    const totalMentions = activity.messages.reduce((s, m) => s + m.mentionCount, 0);
    const imagesMsgCount = activity.messages.filter(m => m.hasAttachment).length;

    const isRaidPattern =
      (distinctChannels >= RAID_MIN_CHANNELS && totalMentions >= RAID_MIN_MENTIONS_TOTAL) ||
      (distinctChannels >= RAID_MIN_CHANNELS && imagesMsgCount >= RAID_MIN_MESSAGES_WITH_IMAGES);

    if (isRaidPattern && !activity.flagged) {
      activity.flagged = true;
      await handleCompromisedAccount(msg.guild, msg.author, activity.messages);
      return;
    }
  }

  // "Hentai" rang — önbevallásos 18+ megerősítéssel: ha valaki leírja ezt a
  // szót (bármelyik csatornán), NEM kapja meg azonnal a rangot, hanem egy
  // gombos megerősítést küldünk neki. Ez nem valódi kor-ellenőrzés (a
  // Discord API nem ad ki életkor-adatot botoknak, és a userek nincsenek
  // összekötve a site-fiókjukkal, ahol tényleges születési dátum alapú
  // ellenőrzés van a 18+ mangáknál) — csak önbevallás, de ez a Discord-
  // szerverek bevett gyakorlata NSFW/18+ tartalomnál. Ehhez is a botnak
  // "Manage Roles" jogosultság kell a szerveren.
  if (msg.guild && /\bhentai\b/i.test(msg.content)) {
    try {
      const member = msg.member || await msg.guild.members.fetch(msg.author.id);
      if (!member.roles.cache.has(MANAGEABLE_ROLES["Hentai"])) {
        const confirmBtn = new ButtonBuilder()
          .setCustomId(`hentai-confirm-${msg.author.id}`)
          .setLabel("🔞 Megerősítem, elmúltam 18 éves")
          .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(confirmBtn);
        await msg.reply({
          content: `${msg.author}, a "Hentai" rang 18+ tartalomhoz ad hozzáférést. Csak akkor kattints a gombra, ha ténylegesen elmúltál 18 éves.`,
          components: [row],
        });
      }
    } catch (err) {
      console.error("Hentai role megerősítés hiba:", err.message);
    }
  }

  if (msg.channelId !== CHANNEL_ID) return;

  const displayName = msg.member?.displayName || msg.author.globalName || msg.author.username;

  // Csatolt képek (nem csak linkelt) URL-jeit is hozzáfűzzük a
  // szöveghez, hogy a webes chat is meg tudja jeleníteni őket.
  let content = msg.content;
  if (msg.attachments.size > 0) {
    const attachmentUrls = [...msg.attachments.values()].map(a => a.url);
    content = [content, ...attachmentUrls].filter(Boolean).join("\n");
  }

  await pool.query(
    `INSERT INTO chat_messages (source, author, display_name, avatar, content)
     VALUES ('discord', $1, $2, $3, $4)`,
    [msg.author.username, displayName, msg.author.displayAvatarURL({ size: 32 }), content]
  );

  broadcast({
    type: "message",
    source: "discord",
    author: msg.author.username,
    displayName: msg.member?.displayName || msg.author.globalName || msg.author.username,
    avatar: msg.author.displayAvatarURL({ size: 32 }),
    content: content,
    timestamp: msg.createdTimestamp
  });
  // Padli AI - figyel a Discord üzenetekre is
  // Ha valaki a Discord natív "Válasz" funkciójával válaszol Padli egy
  // korábbi üzenetére, azt úgy kezeljük, mintha közvetlenül megszólította
  // volna ("padli"-t tartalmazna) — nem kell újra kimondania a nevét.
  let aiContent = msg.content;
  if (msg.reference) {
    try {
      const refMsg = await msg.fetchReference();
      if (refMsg.author.id === bot.user.id) {
        aiContent = "padli " + msg.content;
      }
    } catch {}
  }
  handleChatMessageForAI(
    { content: aiContent, author: msg.author.username, source: "discord", authorId: msg.author.id },
    broadcast
  );
});
bot.on("interactionCreate", async (interaction) => {
  // "Hentai" rang önbevallásos megerősítő gombja — csak az kattinthat
  // érvényesen, aki a trigger-üzenetet küldte (a customId tartalmazza az ő
  // userId-ját), hogy más ne tudjon valaki más nevében "megerősíteni".
  if (interaction.isButton() && interaction.customId.startsWith("hentai-confirm-")) {
    const targetUserId = interaction.customId.slice("hentai-confirm-".length);
    if (interaction.user.id !== targetUserId) {
      await interaction.reply({ content: "❌ Ez a gomb nem neked szól — írd le te is a szót, hogy saját megerősítést kapj.", ephemeral: true });
      return;
    }
    try {
      const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id);
      if (member.roles.cache.has(MANAGEABLE_ROLES["Hentai"])) {
        await interaction.reply({ content: "✅ Már megvan a rangod.", ephemeral: true });
        return;
      }
      await member.roles.add(MANAGEABLE_ROLES["Hentai"]);
      await interaction.reply({ content: "✅ Megerősítve, megkaptad a rangot.", ephemeral: true });
    } catch (err) {
      console.error("Hentai role grant hiba:", err.message);
      await interaction.reply({ content: "❌ Hiba történt, próbáld újra később.", ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "role-give" && interaction.commandName !== "role-remove") return;

  const isAllowed = interaction.member.roles.cache.has(ADMIN_ROLE_ID) || interaction.member.roles.cache.has(MOD_ROLE_ID);
  if (!isAllowed) {
    await interaction.reply({ content: "❌ Ehhez a parancshoz Admin vagy Moderátor rang szükséges.", ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser("user", true);
  const roleName = interaction.options.getString("role", true);
  const roleId = MANAGEABLE_ROLES[roleName];

  if (!roleId) {
    await interaction.reply({ content: "❌ Ismeretlen rang.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const member = await interaction.guild.members.fetch(targetUser.id);
    if (interaction.commandName === "role-give") {
      await member.roles.add(roleId);
      await interaction.editReply(`✅ ${targetUser.username} megkapta a(z) "${roleName}" rangot.`);
    } else {
      await member.roles.remove(roleId);
      await interaction.editReply(`✅ ${targetUser.username}-tól elvéve a(z) "${roleName}" rang.`);
    }
  } catch (err) {
    console.error("Role kezelési hiba:", err.message);
    if (err.code === 50013) {
      await interaction.editReply("❌ A botnak nincs jogosultsága a rangok kezelésére. A szerver beállításaiban add meg neki a \"Manage Roles\" jogosultságot.");
    } else {
      await interaction.editReply("❌ Hiba történt: " + err.message);
    }
  }
});

if (TOKEN) bot.login(TOKEN);
else console.log("ℹ️ Discord bot disabled (no token set)");

// Web → Discord (exportáljuk hogy a route használhassa)
export async function sendNewChaptersEmbed(newChapters) {
  // Ezt most a scan.js saját bottal hívja, nem szükséges innen
}

export async function sendToDiscord(username, content) {
  const channel = await bot.channels.fetch(CHANNEL_ID);
  if (!channel) return;
  await channel.send(`**${username}**: ${content}`);
}

// Kép küldése natív Discord-csatolmányként (nem nyers URL szövegként),
// hogy ne jelenjen meg a link a beágyazott kép mellett.
export async function sendImageToDiscord(username, buffer, filename) {
  const channel = await bot.channels.fetch(CHANNEL_ID);
  if (!channel) return;
  await channel.send({
    content: `**${username}**:`,
    files: [{ attachment: buffer, name: filename }],
  });
}
export async function getGuildEmojis() {
  const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
  const emojis = await guild.emojis.fetch();
  return emojis.map(e => ({
    id: e.id,
    name: e.name,
    url: `https://cdn.discordapp.com/emojis/${e.id}.webp?size=32`
  }));
}
