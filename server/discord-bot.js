import { Client, GatewayIntentBits } from "discord.js";
import { WebSocketServer } from "ws";
import { pool } from "./db.js";
import { handleChatMessageForAI } from "./padli-ai.js";

const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;

// WebSocket szerver a klienseknek

const wss = new WebSocketServer({ port: 3001 });
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
  if (msg.channelId !== CHANNEL_ID) return;
  if (msg.author.bot) return;

  await pool.query(
    `INSERT INTO chat_messages (source, author, avatar, content)
     VALUES ('discord', $1, $2, $3)`,
    [msg.author.username, msg.author.displayAvatarURL({ size: 32 }), msg.content]
  );

  broadcast({
    type: "message",
    source: "discord",
    author: msg.author.username,
    displayName: msg.member?.displayName || msg.author.globalName || msg.author.username,
    avatar: msg.author.displayAvatarURL({ size: 32 }),
    content: msg.content,
    timestamp: msg.createdTimestamp
  });
  // Padli AI – figyel a Discord üzenetekre is
  handleChatMessageForAI(
    { content: msg.content, author: msg.author.username, source: "discord", authorId: msg.author.id },
    broadcast
  );
});
bot.login(TOKEN);

// Web → Discord (exportáljuk hogy a route használhassa)
export async function sendToDiscord(username, content) {
  const channel = await bot.channels.fetch(CHANNEL_ID);
  if (!channel) return;
  await channel.send(`**${username}**: ${content}`);
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
