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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  Partials,
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
    GatewayIntentBits.GuildMembers,       // pour détecter les nouveaux membres
    GatewayIntentBits.GuildMessageReactions, // pour les rôles par réaction
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction], // pour capter les réactions sur d'anciens messages non mis en cache
});

// ============================================================
// LOG D'ACTIVITÉ — envoie chaque action notable du bot dans 〘LOGS〙
// ============================================================
async function logAction(emoji, title, description, color = 0x95a5a6) {
  try {
    const channel = client.channels.cache.get(LOGS_CHANNEL_ID);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${emoji} ${title}`)
      .setDescription(description ? String(description).slice(0, 3900) : null)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch {
    // on évite qu'un souci de logs fasse planter le bot
  }
}

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

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '1496545871595311286';
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '1534996647367545002';

const GIVEAWAY_CHANNEL_ID = process.env.GIVEAWAY_CHANNEL_ID || '1534945543439253574'; // où le giveaway est posté
const GIVEAWAY_RESULTS_CHANNEL_ID = process.env.GIVEAWAY_RESULTS_CHANNEL_ID || '1534083678672650240'; // où le(s) gagnant(s) sont annoncés
const GIVEAWAY_EMOJI = '🎉';
const GIVEAWAY_ROLE_ID = process.env.GIVEAWAY_ROLE_ID || '1534125439273013279';
const GIVEAWAY_CHECK_INTERVAL_MS = 30 * 1000; // vérifie toutes les 30s si un giveaway est terminé

// Rôles par réaction — le bot n'envoie le message QUE via la commande !setuproles,
// jamais automatiquement au démarrage/redéploiement
const ROLE_REACTION_CHANNEL_ID = process.env.ROLE_REACTION_CHANNEL_ID || '1535005312673775658';
const ROLE_REACTION_MENTION_ROLE_ID = process.env.ROLE_REACTION_MENTION_ROLE_ID || '1496545755211759828'; // Membre
const ROLE_REACTION_ROLES = [
  { emoji: '📰', roleId: '1534125436114702416', label: 'News' },
  { emoji: '🎁', roleId: '1534125439273013279', label: 'Giveaway' },
  { emoji: '🎉', roleId: '1534125447288459355', label: 'Event' },
  { emoji: '🎵', roleId: '1534125454074577027', label: 'TikTok' },
  { emoji: '🖼️', roleId: '1534125751488614522', label: 'Showcase' },
];

const TIKTOK_USERNAME = 'ceaxur';
const TIKTOK_ANNOUNCE_CHANNEL_ID = '1529197422348206251';
const TIKTOK_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 min, pour éviter de se faire bloquer par TikTok

// Salons vocaux "compteur" — un par rôle, se met à jour automatiquement
// Les salons doivent déjà exister : le bot se contente de les renommer, il n'en crée plus jamais
const STATS_UPDATE_INTERVAL_MS = 10 * 60 * 1000; // Discord limite les renommages, 10 min = fréquence sûre
const STATS_ROLES = [
  { id: '1496785555491520572', channelId: '1534936713992863925', label: 'Elite', emoji: '👑' },
  { id: '1521117278370926683', channelId: '1534936715418927245', label: 'Supporter', emoji: '⭐' },
  { id: '1496545755211759828', channelId: '1534936716949979236', label: 'Membre', emoji: '👥' },
];

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
      statsChannels: {}, // { roleId: channelId }
      lastStatsUpdate: 0,
      giveaways: {}, // { messageId: { channelId, resultsChannelId, endsAt, winnersCount, prize, hostTag, ended } }
      knownTikTokVideos: [],
    };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
let state = loadState();
if (!state.giveaways) state.giveaways = {}; // compat avec un ancien state.json existant

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
  logAction('🔊', 'Connexion vocale', `Connecté au salon **${channel.name}**`, 0x2ecc71);

  voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('⚠️ Déconnexion vocale détectée, tentative de reconnexion...');
    logAction('⚠️', 'Déconnexion vocale', 'Tentative de reconnexion automatique...', 0xf39c12);
    try {
      await Promise.race([
        entersState(voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      console.error('❌ Reconnexion impossible, nouvelle tentative dans 5s...');
      logAction('❌', 'Reconnexion vocale échouée', 'Nouvelle tentative dans 5 secondes...', 0xe74c3c);
      voiceConnection.destroy();
      setTimeout(connectToVoiceChannel, 5_000);
    }
  });

  voiceConnection.on('error', (error) => {
    console.error('❌ Erreur vocale :', error);
    logAction('❌', 'Erreur vocale', String(error?.message || error), 0xe74c3c);
  });
}

setInterval(() => {
  if (!voiceConnection || voiceConnection.state.status === VoiceConnectionStatus.Destroyed) {
    console.warn('⚠️ Watchdog vocal : reconnexion...');
    logAction('🔁', 'Watchdog vocal', 'Connexion vocale absente, reconnexion déclenchée', 0xf39c12);
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
    // 1. On essaie d'abord l'ID mémorisé (rapide, évite un appel API supplémentaire)
    if (state.statusMessageId) {
      const msg = await channel.messages.fetch(state.statusMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], components: [buildVisitButton()] });
        return;
      }
    }

    // 2. Si l'ID est perdu (ex: redéploiement Railway qui efface le state.json),
    //    on cherche le dernier message posté par le bot lui-même dans ce salon
    //    plutôt que d'en recréer un nouveau à chaque redémarrage
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const ownMessage = recent?.find((m) => m.author.id === client.user.id);
    if (ownMessage) {
      await ownMessage.edit({ embeds: [embed], components: [buildVisitButton()] });
      state.statusMessageId = ownMessage.id;
      saveState(state);
      return;
    }

    // 3. Vraiment aucun message existant : première fois, on en crée un
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
    logAction(
      current.online ? '🟢' : '🔴',
      current.online ? 'Site de nouveau en ligne' : 'Site hors ligne',
      `${WEBSITE_URL} — ${current.online ? `répond en ${current.responseTime} ms` : 'ne répond plus'}`,
      current.online ? 0x2ecc71 : 0xe74c3c
    );
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
    logAction('❌', 'Erreur sitemap', String(err?.message || err), 0xe74c3c);
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
    logAction('❌', 'Erreur RSS', String(err?.message || err), 0xe74c3c);
  }
}

const ANNOUNCE_STYLES = {
  page: { emoji: '📄', color: 0x3498db, label: 'Nouvelle page' },
  produit: { emoji: '🛍️', color: 0x9b59b6, label: 'Nouveau produit' },
  article: { emoji: '📰', color: 0xf39c12, label: 'Nouvel article' },
  maintenance: { emoji: '🛠️', color: 0xe67e22, label: 'Maintenance prévue' },
  info: { emoji: '📢', color: 0x1abc9c, label: 'Annonce' },
};

async function postAnnouncement(type, description, source = 'Automatique') {
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
  logAction('📣', 'Annonce publiée', `Type : **${type}**\nSource : ${source}\n${description}`, style.color);
}

// ============================================================
// 3ter. SALONS VOCAUX "COMPTEUR" PAR RÔLE (renommage uniquement,
// les salons doivent déjà exister — jamais recréés, même après un redéploiement)
// ============================================================
async function updateStatsChannels(guild, force = false) {
  const now = Date.now();
  if (!force && now - state.lastStatsUpdate < STATS_UPDATE_INTERVAL_MS) return; // évite le rate-limit Discord

  for (const role of STATS_ROLES) {
    const channel = guild.channels.cache.get(role.channelId);
    if (!channel) {
      console.error(`❌ Salon stats introuvable pour ${role.label} (ID: ${role.channelId})`);
      continue;
    }

    const guildRole = guild.roles.cache.get(role.id);
    const count = guildRole ? guildRole.members.size : 0;
    const newName = `${role.emoji} ${role.label}: ${count}`;

    if (channel.name !== newName) {
      try {
        const oldName = channel.name;
        await channel.setName(newName);
        logAction('📊', 'Salon stats mis à jour', `${oldName} → **${newName}**`, 0x3498db);
      } catch (err) {
        console.error(`❌ Erreur mise à jour salon stats (${role.label}) :`, err);
        logAction('❌', 'Erreur salon stats', `${role.label} : ${err?.message || err}`, 0xe74c3c);
      }
    }
  }

  state.lastStatsUpdate = now;
  saveState(state);
}

// ============================================================
// 3bis. MESSAGE DE BIENVENUE
// ============================================================
client.on('guildMemberAdd', async (member) => {
  if (!WELCOME_CHANNEL_ID) return;
  const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
  if (!channel) return console.error('❌ WELCOME_CHANNEL_ID invalide');

  try {
    const logoAttachment = new AttachmentBuilder(
      path.join(__dirname, 'assets', 'logo.png'),
      { name: 'logo.png' }
    );
    const bannerAttachment = new AttachmentBuilder(
      path.join(__dirname, 'assets', 'banner.png'),
      { name: 'banner.png' }
    );

    const memberCount = member.guild.memberCount;

    const embed = new EmbedBuilder()
      .setColor(0xE8B4D0) // rose pâle assorti au logo
      .setAuthor({ name: 'CEAXUR', iconURL: 'attachment://logo.png' })
      .setTitle(`✨ Bienvenue, ${member.user.username}`)
      .setDescription(
        `${member} vient de rejoindre **CEAXUR** — content(e) de t'avoir parmi nous !\n\n` +
        `Tu es notre **membre n°${memberCount}** 🎉`
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setImage('attachment://banner.png')
      .setFooter({ text: 'CEAXUR • Bienvenue', iconURL: 'attachment://logo.png' })
      .setTimestamp();

    await channel.send({
      content: `${member} 🌸`,
      embeds: [embed],
      files: [logoAttachment, bannerAttachment],
      components: [buildVisitButton()],
    });

    logAction('👋', 'Nouveau membre', `**${member.user.tag}** a rejoint le serveur (membre n°${memberCount})`, 0x2ecc71);
  } catch (err) {
    console.error('❌ Erreur message de bienvenue :', err);
    logAction('❌', 'Erreur message de bienvenue', String(err?.message || err), 0xe74c3c);
  }
});

client.on('guildMemberRemove', (member) => {
  logAction('🚪', 'Membre parti', `**${member.user.tag}** a quitté le serveur`, 0x95a5a6);
});

// ============================================================
// 3quinquies. RÔLES PAR RÉACTION
// ============================================================
function buildRoleReactionEmbed() {
  return new EmbedBuilder()
    .setColor(0xE8B4D0)
    .setTitle('📥 Choisis tes rôles')
    .setDescription(
      "Réagis avec l'emoji correspondant pour obtenir (ou retirer) un rôle :\n\n" +
      ROLE_REACTION_ROLES.map((r) => `${r.emoji}  **${r.label}**`).join('\n')
    )
    .setFooter({ text: 'CEAXUR • Clique sur une réaction pour basculer le rôle' })
    .setTimestamp();
}

async function postRoleReactionMessage(triggeredBy = 'Automatique') {
  const channel = client.channels.cache.get(ROLE_REACTION_CHANNEL_ID);
  if (!channel) return { error: 'Salon rôles introuvable.' };

  const sent = await channel.send({
    content: ROLE_REACTION_MENTION_ROLE_ID ? `<@&${ROLE_REACTION_MENTION_ROLE_ID}> 📥 Nouveaux rôles disponibles !` : undefined,
    embeds: [buildRoleReactionEmbed()],
  });

  for (const r of ROLE_REACTION_ROLES) {
    await sent.react(r.emoji).catch(() => {});
  }

  logAction('📥', 'Message rôles publié', `Par : ${triggeredBy}`, 0xE8B4D0);
  return { message: sent };
}

// Ajoute/retire le rôle correspondant quand quelqu'un réagit dans le salon dédié.
// On se base sur le SALON (pas sur un ID de message mémorisé) pour rester fiable
// même si le fichier de sauvegarde est perdu suite à un redéploiement Railway.
async function handleRoleReaction(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }
  if (reaction.message.channelId !== ROLE_REACTION_CHANNEL_ID) return;

  const emojiName = reaction.emoji.name;
  const roleConfig = ROLE_REACTION_ROLES.find((r) => r.emoji === emojiName);
  if (!roleConfig) return;

  try {
    const guild = reaction.message.guild;
    const member = await guild.members.fetch(user.id);
    if (add) {
      await member.roles.add(roleConfig.roleId);
      logAction('✅', 'Rôle attribué', `**${roleConfig.label}** → ${user.tag} (réaction)`, 0x2ecc71);
    } else {
      await member.roles.remove(roleConfig.roleId);
      logAction('➖', 'Rôle retiré', `**${roleConfig.label}** → ${user.tag} (réaction retirée)`, 0x95a5a6);
    }
  } catch (err) {
    console.error('❌ Erreur rôle par réaction :', err);
    logAction('❌', 'Erreur rôle par réaction', String(err?.message || err), 0xe74c3c);
  }
}

client.on('messageReactionAdd', (reaction, user) => handleRoleReaction(reaction, user, true));
client.on('messageReactionRemove', (reaction, user) => handleRoleReaction(reaction, user, false));

// ============================================================
// 3quater. GIVEAWAYS
// ============================================================

// Parse une durée du style "24h", "2d", "30m", "1h30m" en millisecondes
function parseDuration(input) {
  const regex = /(\d+)\s*(j|d|h|m|s)/gi;
  let totalMs = 0;
  let match;
  let found = false;
  while ((match = regex.exec(input)) !== null) {
    found = true;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 'j' || unit === 'd') totalMs += value * 24 * 60 * 60 * 1000;
    else if (unit === 'h') totalMs += value * 60 * 60 * 1000;
    else if (unit === 'm') totalMs += value * 60 * 1000;
    else if (unit === 's') totalMs += value * 1000;
  }
  return found ? totalMs : null;
}

function pickRandomWinners(candidates, count) {
  const pool = [...candidates];
  const winners = [];
  while (pool.length > 0 && winners.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }
  return winners;
}

function buildGiveawayEmbed({ prize, winnersCount, endsAt, hostTag, ended = false, winners = null }) {
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x95a5a6 : 0xE8B4D0)
    .setTitle(ended ? '🔒 GIVEAWAY TERMINÉ' : '🎉 GIVEAWAY 🎉')
    .setDescription(`**${prize}**`)
    .addFields(
      { name: '🏆 Gagnant(s)', value: `${winnersCount}`, inline: true },
      {
        name: ended ? '⏰ Terminé' : '⏰ Se termine',
        value: `<t:${Math.floor(endsAt / 1000)}:R>`,
        inline: true,
      },
      { name: '👤 Organisé par', value: hostTag, inline: true },
    )
    .setFooter({ text: 'CEAXUR • Giveaway' })
    .setTimestamp();

  if (ended) {
    embed.addFields({
      name: '🎊 Résultat',
      value: winners && winners.length > 0
        ? winners.map((w) => `<@${w}>`).join(', ')
        : 'Personne n\'a participé 😢',
    });
  } else {
    embed.addFields({ name: '\u200b', value: `Réagis avec ${GIVEAWAY_EMOJI} pour participer !` });
  }

  return embed;
}

async function endGiveaway(messageId, { reroll = false } = {}) {
  const giveaway = state.giveaways[messageId];
  if (!giveaway) return { error: 'Giveaway introuvable.' };

  const channel = client.channels.cache.get(giveaway.channelId);
  if (!channel) return { error: 'Salon du giveaway introuvable.' };

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return { error: 'Message du giveaway introuvable (peut-être supprimé).' };

  const reaction = message.reactions.cache.get(GIVEAWAY_EMOJI);
  const users = reaction ? await reaction.users.fetch() : new Map();
  const candidates = [...users.values()].filter((u) => !u.bot).map((u) => u.id);

  const winners = pickRandomWinners(candidates, giveaway.winnersCount);

  // édite l'embed original pour marquer "terminé"
  const finalEmbed = buildGiveawayEmbed({
    prize: giveaway.prize,
    winnersCount: giveaway.winnersCount,
    endsAt: giveaway.endsAt,
    hostTag: giveaway.hostTag,
    ended: true,
    winners,
  });
  await message.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});

  // poste le résultat dans le salon dédié
  const resultsChannel = client.channels.cache.get(giveaway.resultsChannelId);
  if (resultsChannel) {
    const resultEmbed = new EmbedBuilder()
      .setColor(winners.length > 0 ? 0x2ecc71 : 0x95a5a6)
      .setTitle(reroll ? '🔁 Nouveau tirage' : '🎊 Résultat du giveaway')
      .setDescription(
        winners.length > 0
          ? `**${giveaway.prize}**\n\nFélicitations ${winners.map((w) => `<@${w}>`).join(', ')} 🎉`
          : `**${giveaway.prize}**\n\nPersonne n'a participé, aucun gagnant cette fois 😢`
      )
      .setTimestamp();
    await resultsChannel.send({ embeds: [resultEmbed] }).catch(() => {});
  }

  giveaway.ended = true;
  saveState(state);

  logAction(
    '🎊',
    reroll ? 'Giveaway re-tiré' : 'Giveaway terminé',
    `**${giveaway.prize}**\nGagnant(s) : ${winners.length > 0 ? winners.map((w) => `<@${w}>`).join(', ') : 'aucun'}`,
    0x2ecc71
  );

  return { winners };
}

async function checkGiveaways() {
  const now = Date.now();
  for (const [messageId, giveaway] of Object.entries(state.giveaways)) {
    if (!giveaway.ended && giveaway.endsAt <= now) {
      await endGiveaway(messageId);
    }
  }
}

// ============================================================
// 4. COMMANDES (!status, !annonce)
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === 'setuproles') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) return message.reply('❌ Seuls les administrateurs peuvent faire ça.');

    const result = await postRoleReactionMessage(message.author.tag);
    if (result.error) return message.reply(`❌ ${result.error}`);
    message.reply(`✅ Message des rôles publié dans <#${ROLE_REACTION_CHANNEL_ID}>.`);
  }

  if (command === 'ping') {
    const start = Date.now();
    const sent = await message.reply('🏓 Calcul en cours...');
    const roundtrip = Date.now() - start;
    const wsLatency = Math.round(client.ws.ping);

    const embed = new EmbedBuilder()
      .setColor(wsLatency < 150 ? 0x2ecc71 : wsLatency < 400 ? 0xf39c12 : 0xe74c3c)
      .setTitle('🏓 Pong !')
      .addFields(
        { name: 'Latence bot', value: `${roundtrip} ms`, inline: true },
        { name: 'Latence Discord (WebSocket)', value: `${wsLatency} ms`, inline: true },
      )
      .setTimestamp();

    await sent.edit({ content: null, embeds: [embed] });
  }

  if (command === 'status') {
    const current = await pingWebsite();
    const embed = buildStatusEmbed(current);
    message.reply({ embeds: [embed], components: [buildVisitButton()] });
    logAction('💬', 'Commande utilisée', `\`!status\` par **${message.author.tag}**`);
  }

  if (command === 'annonce') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      logAction('🚫', 'Commande refusée', `\`!annonce\` tenté par **${message.author.tag}** (pas admin)`, 0xe74c3c);
      return message.reply('❌ Seuls les administrateurs peuvent utiliser cette commande.');
    }

    const type = args.shift()?.toLowerCase();
    const text = args.join(' ');

    if (!type || !text || !ANNOUNCE_STYLES[type]) {
      return message.reply(
        `Utilisation : \`${PREFIX}annonce <page|produit|article|maintenance|info> <message>\``
      );
    }

    await postAnnouncement(type, text, `Manuelle — ${message.author.tag}`);
    message.reply('✅ Annonce publiée.');
  }

  if (command === 'giveaway') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      logAction('🚫', 'Commande refusée', `\`!giveaway\` tenté par **${message.author.tag}** (pas admin)`, 0xe74c3c);
      return message.reply('❌ Seuls les administrateurs peuvent lancer un giveaway.');
    }

    const durationStr = args.shift();
    const winnersCount = parseInt(args.shift(), 10);
    const prize = args.join(' ');
    const durationMs = durationStr ? parseDuration(durationStr) : null;

    if (!durationMs || !winnersCount || winnersCount < 1 || !prize) {
      return message.reply(
        `Utilisation : \`${PREFIX}giveaway <durée ex: 24h, 2j, 30m> <nb_gagnants> <lot>\`\n` +
        `Exemple : \`${PREFIX}giveaway 24h 1 Un abonnement premium 1 mois\``
      );
    }

    const channel = client.channels.cache.get(GIVEAWAY_CHANNEL_ID);
    if (!channel) return message.reply('❌ Salon giveaway introuvable, vérifie GIVEAWAY_CHANNEL_ID.');

    const endsAt = Date.now() + durationMs;
    const embed = buildGiveawayEmbed({
      prize,
      winnersCount,
      endsAt,
      hostTag: message.author.tag,
    });

    const sent = await channel.send({
      content: GIVEAWAY_ROLE_ID ? `<@&${GIVEAWAY_ROLE_ID}> ${GIVEAWAY_EMOJI}` : undefined,
      embeds: [embed],
    });
    await sent.react(GIVEAWAY_EMOJI);

    state.giveaways[sent.id] = {
      channelId: GIVEAWAY_CHANNEL_ID,
      resultsChannelId: GIVEAWAY_RESULTS_CHANNEL_ID,
      endsAt,
      winnersCount,
      prize,
      hostTag: message.author.tag,
      ended: false,
    };
    saveState(state);

    logAction('🎉', 'Giveaway lancé', `**${prize}**\nGagnant(s) : ${winnersCount}\nPar : ${message.author.tag}\nDurée : ${durationStr}`, 0xE8B4D0);
    message.reply(`✅ Giveaway lancé dans <#${GIVEAWAY_CHANNEL_ID}> !`);
  }

  if (command === 'greroll') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) return message.reply('❌ Seuls les administrateurs peuvent relancer un tirage.');

    const messageId = args[0];
    if (!messageId || !state.giveaways[messageId]) {
      return message.reply(`Utilisation : \`${PREFIX}greroll <id_du_message_giveaway>\``);
    }

    const result = await endGiveaway(messageId, { reroll: true });
    if (result.error) return message.reply(`❌ ${result.error}`);
    message.reply('✅ Nouveau tirage effectué.');
  }

  if (command === 'gend') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) return message.reply('❌ Seuls les administrateurs peuvent terminer un giveaway.');

    const messageId = args[0];
    const giveaway = state.giveaways[messageId];
    if (!messageId || !giveaway) {
      return message.reply(`Utilisation : \`${PREFIX}gend <id_du_message_giveaway>\``);
    }
    if (giveaway.ended) return message.reply('⚠️ Ce giveaway est déjà terminé.');

    const result = await endGiveaway(messageId);
    if (result.error) return message.reply(`❌ ${result.error}`);
    message.reply('✅ Giveaway terminé manuellement.');
  }
});

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  logAction('✅', 'Bot démarré', `Connecté en tant que **${client.user.tag}**`, 0x2ecc71);

  client.user.setPresence({
    activities: [{ name: 'ceaxur.ch', type: ActivityType.Watching }],
    status: 'online',
  });

  connectToVoiceChannel();

  monitorWebsite();
  setInterval(monitorWebsite, CHECK_INTERVAL_MS);

  checkSitemap();
  checkRSS();
  setInterval(() => {
    checkSitemap();
    checkRSS();
  }, WATCH_INTERVAL_MS);

  // Salons stats par rôle
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    try {
      await guild.members.fetch(); // charge tous les membres pour un comptage précis des rôles
    } catch (err) {
      console.error('❌ Erreur chargement des membres :', err);
    }
    await updateStatsChannels(guild, true); // première mise à jour immédiate
    setInterval(() => updateStatsChannels(guild), STATS_UPDATE_INTERVAL_MS);
  }

  // Giveaways — reprend les giveaways en cours après un redémarrage, puis vérifie en continu
  checkGiveaways();
  setInterval(checkGiveaways, GIVEAWAY_CHECK_INTERVAL_MS);
});

// Déclenche une tentative de mise à jour des salons stats (respecte le délai anti rate-limit)
client.on('guildMemberAdd', (member) => updateStatsChannels(member.guild));
client.on('guildMemberRemove', (member) => updateStatsChannels(member.guild));
client.on('guildMemberUpdate', (oldMember, newMember) => updateStatsChannels(newMember.guild));

client.login(process.env.DISCORD_TOKEN);
