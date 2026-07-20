/* ── Slash parancsok regisztrálása: /role-give, /role-remove ──
   Egyszeri, kézi futtatás: node server/scripts/register-role-commands.mjs
   Guild-scoped regisztráció (nem globális), ezért azonnal elérhető,
   nem kell rá ~1 órát várni. Nem érint felhasználókat, csak a
   parancsokat teszi láthatóvá a Discord parancs-választójában. ── */
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const ROLE_CHOICES = ["Tag", "Támogató", "Booster", "Szuper Támogató", "Hentai"];

function buildRoleCommand(name, description, userDescription) {
  const cmd = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addUserOption(opt => opt.setName("user").setDescription(userDescription).setRequired(true))
    .addStringOption(opt => {
      opt.setName("role").setDescription("Melyik rangot").setRequired(true);
      ROLE_CHOICES.forEach(r => opt.addChoices({ name: r, value: r }));
      return opt;
    });
  return cmd.toJSON();
}

const commands = [
  buildRoleCommand("role-give", "Rang adása egy felhasználónak", "Kinek adjuk a rangot"),
  buildRoleCommand("role-remove", "Rang elvétele egy felhasználótól", "Kitől vegyük el a rangot"),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);

async function main() {
  const app = await rest.get(Routes.oauth2CurrentApplication());
  const clientId = app.id;

  await rest.put(
    Routes.applicationGuildCommands(clientId, process.env.DISCORD_GUILD_ID),
    { body: commands }
  );
  console.log(`✅ ${commands.length} parancs regisztrálva a szerveren: ${commands.map(c => "/" + c.name).join(", ")}`);
}

main().catch(err => {
  console.error("❌ Regisztrációs hiba:", err.message);
  process.exit(1);
});
