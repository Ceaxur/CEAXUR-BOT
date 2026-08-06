// ============================================================
// BOT CEAXUR — vocal permanent + monitoring du site + annonces
// ============================================================
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  PermissionsBitField,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,   // pour la voix
    GatewayIntentBits.GuildMessages,      // pour lire les commandes
    GatewayIntentBits.MessageContent,     // pour lire le contenu des commandes
  ],
});

// ============================================================
// CONFIGURATION (variables d'environnement, avec valeurs par défaut)
// ============================================================
const GUILD_ID = process.env.GUILD_ID || '1392549604163321936';
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || '1534683272683192521';

const WEBSITE_URL = process.env.WEBSITE_URL || 'https://ceaxur.ch';
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID || '1534848325973446787'; // salon pour l'embed de statut auto
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || '1534848458085765200'; // salon pour les annonces

// Optionnels : laisser vide dans Railway si ton site n'a pas ça
const SITEMAP_URL = process.env.SITEMAP_URL || ''; // ex: https://ceaxur.ch/sitemap.xml
const RSS_URL = process.env.RSS_URL || '';          // ex: https://ceaxur.ch/feed.xml

const CHECK_INTERVAL_MS = 2 * 60 * 1000;   // vérifie le site toutes les 2 minutes
const WATCH_INTERVAL_MS = 10 * 60 * 1000;  // vérifie sitemap/RSS toutes les 10 minutes
const PREFIX = '!';

// Fichiers de sauvegarde locale (persistent tant que le container n'est pas rebuild)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      statusMessageId: null,
      knownPages: [],
      knownArticles: [],
      history: [], // { t: timestamp, online: bool }
      lastDay: null,
    };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
let state = loadState();

// ============================================================
// 1. CONNEXION VOCALE PERMANENTE (fonction déjà en place)
// ============================================================
let voiceConnection = null;

function connectToVoiceChannel() {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return console.error(`❌ Serveur introuvable (GUILD_ID: ${GUILD_ID})`);

  const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!channel) return console.error(`❌ Salon vocal introuvable (VOICE_CHANNEL_ID: ${VOICE_CHANNEL_ID})`);

  voiceConnection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: true,
  });

  console.log(`🔊 Connecté au salon vocal : ${channel.name}`);

  voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('⚠️ Déconnexion vocale détectée, tentative de reconnexion...');
    try {
      await Promise.race([
        entersState(voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      console.error('❌ Reconnexion impossible, nouvelle tentative dans 5s...');
      voiceConnection.destroy();
      setTimeout(connectToVoiceChannel, 5_000);
    }
  });

  voiceConnection.on('error', (error) => console.error('❌ Erreur vocale :', error));
}

setInterval(() => {
  if (!voiceConnection || voiceConnection.state.status === VoiceConnectionStatus.Destroyed) {
    console.warn('⚠️ Watchdog vocal : reconnexion...');
    connectToVoiceChannel();
  }
}, 30_000);

// ============================================================
// 2. MONITORING DU SITE
// ============================================================
let lastKnownOnline = null; // pour détecter les changements d'état

async function pingWebsite() {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(WEBSITE_URL, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    const responseTime = Date.now() - start;
    return { online: res.ok, responseTime, statusCode: res.status };
  } catch {
    return { online: false, responseTime: null, statusCode: null };
  }
}

function resetHistoryIfNewDay() {
  const today = new Date().toDateString();
  if (state.lastDay !== today) {
    state.history = [];
    state.lastDay = today;
  }
}

function computeUptimeToday() {
  if (state.history.length === 0) return 100;
  const onlineCount = state.history.filter((h) => h.online).length;
  return Math.round((onlineCount / state.history.length) * 1000) / 10; // 1 décimale
}

function buildVisitButton() {
  const button = new ButtonBuilder()
    .setLabel('🌐 Visiter le site')
    .setStyle(ButtonStyle.Link)
    .setURL(WEBSITE_URL);
  return new ActionRowBuilder().addComponents(button);
}

function buildUptimeBar(percent) {
  const totalBlocks = 10;
  const filled = Math.round((percent / 100) * totalBlocks);
  return '▰'.repeat(filled) + '▱'.repeat(totalBlocks - filled);
}

function formatResponseTime(ms) {
  if (ms === null) return 'N/A';
  if (ms < 300) return `🟢 ${ms} ms (excellent)`;
  if (ms < 800) return `🟡 ${ms} ms (correct)`;
  return `🟠 ${ms} ms (lent)`;
}

function buildStatusEmbed(current) {
  const uptime = computeUptimeToday();
  const domain = WEBSITE_URL.replace('https://', '').replace('http://', '');
  const checksToday = state.history.length;

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Moniteur de site', iconURL: client.user?.displayAvatarURL() })
    .setTitle(`${current.online ? '🟢' : '🔴'}  ${domain}`)
    .setURL(WEBSITE_URL)
    .setColor(current.online ? 0x2ecc71 : 0xe74c3c)
    .setThumbnail(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`)
    .setDescription(
      current.online
        ? `Le site répond normalement (HTTP ${current.statusCode ?? '—'})`
        : '⚠️ Le site ne répond pas actuellement'
    )
    .addFields(
      {
        name: "📊 Disponibilité aujourd'hui",
        value: `${buildUptimeBar(uptime)}  **${uptime}%**\n_${checksToday} vérifications effectuées_`,
      },
      { name: '⏱️ Temps de réponse', value: formatResponseTime(current.responseTime), inline: true },
      { name: '🔄 Fréquence', value: 'Toutes les 2 min', inline: true },
    )
    .setFooter({ text: 'Dernière vérification', iconURL: client.user?.displayAvatarURL() })
    .setTimestamp();
  return embed;
}

async function updateStatusEmbed(current) {
  if (!STATUS_CHANNEL_ID) return;
  const channel = client.channels.cache.get(STATUS_CHANNEL_ID);
  if (!channel) return console.error('❌ STATUS_CHANNEL_ID invalide');

  const embed = buildStatusEmbed(current);

  try {
    if (state.statusMessageId) {
      const msg = await channel.messages.fetch(state.statusMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], components: [buildVisitButton()] });
        return;
      }
    }
    // pas de message existant, on en crée un nouveau
    const sent = await channel.send({ embeds: [embed], components: [buildVisitButton()] });
    state.statusMessageId = sent.id;
    saveState(state);
  } catch (err) {
    console.error('❌ Erreur mise à jour embed statut :', err);
  }
}

async function sendStatusChangeAlert(current) {
  if (!ANNOUNCE_CHANNEL_ID) return;
  const channel = client.channels.cache.get(ANNOUNCE_CHANNEL_ID);
  if (!channel) return;

  const domain = WEBSITE_URL.replace('https://', '').replace('http://', '');
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Moniteur de site', iconURL: client.user?.displayAvatarURL() })
    .setColor(current.online ? 0x2ecc71 : 0xe74c3c)
    .setTitle(current.online ? '🟢 Site de nouveau en ligne' : '🔴 Site hors ligne')
    .setURL(WEBSITE_URL)
    .setThumbnail(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`)
    .setDescription(
      current.online
        ? `**${domain}** répond de nouveau normalement.`
        : `**${domain}** ne répond plus. Vérification en cours...`
    )
    .setTimestamp();

  channel.send({ embeds: [embed], components: [buildVisitButton()] }).catch(() => {});
}

async function monitorWebsite() {
  resetHistoryIfNewDay();
  const current = await pingWebsite();

  state.history.push({ t: Date.now(), online: current.online });
  saveState(state);

  if (lastKnownOnline !== null && lastKnownOnline !== current.online) {
    await sendStatusChangeAlert(current);
  }
  lastKnownOnline = current.online;

  await updateStatusEmbed(current);
}

// ============================================================
// 3. ANNONCES AUTOMATIQUES (sitemap + RSS)
// ============================================================
function extractTags(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'g');
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) results.push(match[1].trim());
  return results;
}

async function checkSitemap() {
  if (!SITEMAP_URL) return;
  try {
    const res = await fetch(SITEMAP_URL);
    const xml = await res.text();
    const urls = extractTags(xml, 'loc');

    const isFirstRun = state.knownPages.length === 0;
    const newUrls = urls.filter((u) => !state.knownPages.includes(u));

    state.knownPages = urls;
    saveState(state);

    if (isFirstRun) return; // évite de spammer toutes les pages existantes au 1er lancement

    for (const url of newUrls) {
      await postAnnouncement('page', `Une nouvelle page vient d'être publiée :\n${url}`);
    }
  } catch (err) {
    console.error('❌ Erreur lecture sitemap :', err);
  }
}

async function checkRSS() {
  if (!RSS_URL) return;
  try {
    const res = await fetch(RSS_URL);
    const xml = await res.text();
    const links = extractTags(xml, 'link');
    const titles = extractTags(xml, 'title');

    const isFirstRun = state.knownArticles.length === 0;
    const newLinks = links.filter((l) => !state.knownArticles.includes(l));

    state.knownArticles = links;
    saveState(state);

    if (isFirstRun) return;

    for (const link of newLinks) {
      const idx = links.indexOf(link);
      const title = titles[idx + 1] || titles[idx] || 'Nouvel article'; // +1 car le 1er <title> est souvent celui du flux
      await postAnnouncement('article', `**${title}**\n${link}`);
    }
  } catch (err) {
    console.error('❌ Erreur lecture RSS :', err);
  }
}

const ANNOUNCE_STYLES = {
  page: { emoji: '📄', color: 0x3498db, label: 'Nouvelle page' },
  produit: { emoji: '🛍️', color: 0x9b59b6, label: 'Nouveau produit' },
  article: { emoji: '📰', color: 0xf39c12, label: 'Nouvel article' },
  maintenance: { emoji: '🛠️', color: 0xe67e22, label: 'Maintenance prévue' },
  info: { emoji: '📢', color: 0x1abc9c, label: 'Annonce' },
};

async function postAnnouncement(type, description) {
  if (!ANNOUNCE_CHANNEL_ID) return console.warn('⚠️ ANNOUNCE_CHANNEL_ID non défini, annonce ignorée');
  const channel = client.channels.cache.get(ANNOUNCE_CHANNEL_ID);
  if (!channel) return console.error('❌ ANNOUNCE_CHANNEL_ID invalide');

  const style = ANNOUNCE_STYLES[type] || ANNOUNCE_STYLES.info;
  const domain = WEBSITE_URL.replace('https://', '').replace('http://', '');
  const embed = new EmbedBuilder()
    .setAuthor({ name: domain, iconURL: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`, url: WEBSITE_URL })
    .setColor(style.color)
    .setTitle(`${style.emoji} ${style.label}`)
    .setDescription(description)
    .setFooter({ text: 'CEAXUR • Annonces', iconURL: client.user?.displayAvatarURL() })
    .setTimestamp();

  await channel.send({ embeds: [embed], components: [buildVisitButton()] });
}

// ============================================================
// 4. COMMANDES (!status, !annonce)
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === 'status') {
    const current = await pingWebsite();
    const embed = buildStatusEmbed(current);
    message.reply({ embeds: [embed], components: [buildVisitButton()] });
  }

  if (command === 'annonce') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return message.reply('❌ Seuls les administrateurs peuvent utiliser cette commande.');
    }

    const type = args.shift()?.toLowerCase();
    const text = args.join(' ');

    if (!type || !text || !ANNOUNCE_STYLES[type]) {
      return message.reply(
        `Utilisation : \`${PREFIX}annonce <page|produit|article|maintenance|info> <message>\``
      );
    }

    await postAnnouncement(type, text);
    message.reply('✅ Annonce publiée.');
  }
});

// ============================================================
// 4bis. SLASH COMMAND /annonce (menu déroulant natif Discord)
// ============================================================
const slashCommands = [
  new SlashCommandBuilder()
    .setName('annonce')
    .setDescription('Publier une annonce officielle dans le salon annonces')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) // visible/utilisable par les admins uniquement
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Type de contenu annoncé')
        .setRequired(true)
        .addChoices(
          { name: '📄 Nouvelle page', value: 'page' },
          { name: '🛍️ Nouveau produit', value: 'produit' },
          { name: '📰 Nouvel article', value: 'article' },
          { name: '🛠️ Maintenance prévue', value: 'maintenance' },
          { name: '📢 Info générale', value: 'info' },
        )
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription("Le texte de l'annonce")
        .setRequired(true)
        .setMaxLength(1000)
    )
    .addStringOption((option) =>
      option
        .setName('lien')
        .setDescription('Lien optionnel à inclure (ex: vers le produit/article)')
        .setRequired(false)
    ),
].map((cmd) => cmd.toJSON());

async function registerSlashCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: slashCommands });
    console.log('✅ Slash commands enregistrées (/annonce)');
  } catch (err) {
    console.error('❌ Erreur enregistrement slash commands :', err);
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'annonce') return;

  const type = interaction.options.getString('type');
  const message = interaction.options.getString('message');
  const lien = interaction.options.getString('lien');

  const description = lien ? `${message}\n\n🔗 ${lien}` : message;

  await postAnnouncement(type, description);
  await interaction.reply({ content: '✅ Annonce publiée avec succès.', ephemeral: true });
});


client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: 'ceaxur.ch', type: ActivityType.Watching }],
    status: 'online',
  });

  connectToVoiceChannel();
  registerSlashCommands();

  monitorWebsite();
  setInterval(monitorWebsite, CHECK_INTERVAL_MS);

  checkSitemap();
  checkRSS();
  setInterval(() => {
    checkSitemap();
    checkRSS();
  }, WATCH_INTERVAL_MS);
});

client.login(process.env.DISCORD_TOKEN);
