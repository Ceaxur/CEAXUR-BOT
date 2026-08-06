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
    GatewayIntentBits.GuildMessageReactions, // pour détecter les participations aux giveaways
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User], // pour retrouver les réactions même après un redémarrage
});

// ============================================================
// CONFIGURATION (variables d'environnement, avec valeurs par défaut)
// ============================================================
const GUILD_ID = process.env.GUILD_ID || '1392549604163321936';
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || '1534683272683192521';

const WEBSITE_URL = process.env.WEBSITE_URL || 'https://ceaxur.ch';
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID || '1534848325973446787'; // salon pour l'embed de statut auto
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID || '1534848458085765200'; // salon pour les annonces

// Giveaways : salon où l'embed du giveaway est posté (peu importe où la commande !giveaway est tapée)
const GIVEAWAY_CHANNEL_ID = process.env.GIVEAWAY_CHANNEL_ID || '1496545877811265700';
// Salon où le message "Félicitations @untel" est posté à la fin
const WINNER_CHANNEL_ID = process.env.WINNER_CHANNEL_ID || '1534083678672650240';
// Rôle mentionné à chaque lancement de giveaway (pour notifier tout le monde)
const GIVEAWAY_ROLE_ID = process.env.GIVEAWAY_ROLE_ID || '1534125439273013279';
const GIVEAWAY_EMOJI = '🎉';
const GIVEAWAY_CHECK_INTERVAL_MS = 60 * 1000; // vérifie les giveaways arrivés à échéance toutes les minutes

// Optionnels : laisser vide dans Railway si ton site n'a pas ça
const SITEMAP_URL = process.env.SITEMAP_URL || ''; // ex: https://ceaxur.ch/sitemap.xml
const RSS_URL = process.env.RSS_URL || '';          // ex: https://ceaxur.ch/feed.xml

const CHECK_INTERVAL_MS = 2 * 60 * 1000;   // vérifie le site toutes les 2 minutes
const WATCH_INTERVAL_MS = 10 * 60 * 1000;  // vérifie sitemap/RSS toutes les 10 minutes
const PREFIX = '!';

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '1496545871595311286';

// Salons vocaux "compteur" — un par rôle, se met à jour automatiquement
const STATS_CATEGORY_ID = process.env.STATS_CATEGORY_ID || null; // optionnel : ID d'une catégorie pour ranger les salons stats
const STATS_UPDATE_INTERVAL_MS = 10 * 60 * 1000; // Discord limite les renommages, 10 min = fréquence sûre
const STATS_ROLES = [
  { id: '1496785555491520572', label: 'Elite', emoji: '👑' },
  { id: '1521117278370926683', label: 'Supporter', emoji: '⭐' },
  { id: '1496545755211759828', label: 'Membre', emoji: '👥' },
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
      giveaways: {}, // { messageId: { channelId, endsAt, winnersCount, prize, organizerId, ended, winners } }
    };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
let state = loadState();
if (!state.giveaways) state.giveaways = {}; // rétrocompatibilité si state.json existe déjà sans ce champ

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
// 3quater. SYSTÈME DE GIVEAWAYS
// ============================================================

// Parse une durée du type "24h", "1d", "30m", "1d12h", "2h30m" -> ms
function parseDuration(input) {
  const regex = /(\d+)\s*(d|h|m|s)/gi;
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  let totalMs = 0;
  let matched = false;
  let match;
  while ((match = regex.exec(input)) !== null) {
    matched = true;
    totalMs += parseInt(match[1], 10) * multipliers[match[2].toLowerCase()];
  }
  return matched ? totalMs : null;
}

function buildGiveawayEmbed(giveaway, ended = false, winners = []) {
  const endsAtSec = Math.floor(giveaway.endsAt / 1000);
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x95a5a6 : 0xf1c40f)
    .setTitle(ended ? '🔒 GIVEAWAY TERMINÉ 🔒' : '🎉 GIVEAWAY 🎉')
    .setDescription(`**${giveaway.prize}**`)
    .addFields(
      { name: '🏆 Gagnants', value: `${giveaway.winnersCount}`, inline: true },
      {
        name: ended ? '⏰ Terminé' : '⏰ Se termine',
        value: ended ? `<t:${endsAtSec}:f>` : `<t:${endsAtSec}:R> (<t:${endsAtSec}:f>)`,
        inline: true,
      },
      { name: '👤 Organisé par', value: `<@${giveaway.organizerId}>`, inline: true },
    )
    .setFooter({ text: 'CEAXUR • Giveaway', iconURL: client.user?.displayAvatarURL() })
    .setTimestamp();

  if (ended) {
    embed.addFields({
      name: '🎊 Gagnant(s)',
      value: winners.length ? winners.map((id) => `<@${id}>`).join(', ') : "Personne n'a participé 😢",
    });
  } else {
    embed.addFields({ name: '\u200b', value: `Réagis avec ${GIVEAWAY_EMOJI} pour participer !` });
  }

  return embed;
}

async function startGiveaway(message, durationStr, winnersStr, prize) {
  const durationMs = parseDuration(durationStr || '');
  const winnersCount = parseInt(winnersStr, 10);

  if (!durationMs || !winnersCount || winnersCount < 1 || !prize) {
    return message.reply(
      `Utilisation : \`${PREFIX}giveaway <durée> <nombre de gagnants> <lot>\`\nExemple : \`${PREFIX}giveaway 24h 1 Un abonnement premium 1 mois\``
    );
  }

  const targetChannel = client.channels.cache.get(GIVEAWAY_CHANNEL_ID) || message.channel;
  const endsAt = Date.now() + durationMs;

  const giveaway = {
    channelId: targetChannel.id,
    endsAt,
    winnersCount,
    prize,
    organizerId: message.author.id,
    ended: false,
    winners: [],
  };

  const embed = buildGiveawayEmbed(giveaway);
  const sent = await targetChannel.send({
    content: GIVEAWAY_ROLE_ID ? `<@&${GIVEAWAY_ROLE_ID}>` : undefined,
    embeds: [embed],
  });
  await sent.react(GIVEAWAY_EMOJI);

  state.giveaways[sent.id] = giveaway;
  saveState(state);

  if (targetChannel.id !== message.channel.id) {
    message.reply(`✅ Giveaway lancé dans ${targetChannel} !`);
  } else {
    message.react('✅').catch(() => {});
  }
}

async function pickWinners(channel, messageId, count) {
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return { participants: [], winners: [] };

  const reaction = msg.reactions.cache.get(GIVEAWAY_EMOJI);
  if (!reaction) return { participants: [], winners: [] };

  const users = await reaction.users.fetch();
  const participants = users.filter((u) => !u.bot).map((u) => u.id);

  const pool = [...participants];
  const winners = [];
  const winnersToPick = Math.min(count, pool.length);
  for (let i = 0; i < winnersToPick; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }

  return { participants, winners };
}

async function endGiveaway(messageId, opts = {}) {
  const giveaway = state.giveaways[messageId];
  if (!giveaway) {
    if (opts.replyTo) opts.replyTo.reply('❌ Giveaway introuvable.');
    return;
  }
  if (giveaway.ended) {
    if (opts.replyTo) opts.replyTo.reply('⚠️ Ce giveaway est déjà terminé.');
    return;
  }

  const channel = client.channels.cache.get(giveaway.channelId);
  if (!channel) return console.error(`❌ Salon introuvable pour le giveaway ${messageId}`);

  const { winners } = await pickWinners(channel, messageId, giveaway.winnersCount);

  giveaway.ended = true;
  giveaway.winners = winners;
  saveState(state);

  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (msg) {
    await msg.edit({ embeds: [buildGiveawayEmbed(giveaway, true, winners)] }).catch(() => {});
  }

  const winnerChannel = client.channels.cache.get(WINNER_CHANNEL_ID) || channel;

  if (winners.length) {
    await winnerChannel.send(
      `🎉 Félicitations ${winners.map((id) => `<@${id}>`).join(', ')}, tu as gagné : **${giveaway.prize}** !`
    );
  } else {
    await winnerChannel.send(`😢 Personne n'a participé au giveaway **${giveaway.prize}**, aucun gagnant.`);
  }

  if (opts.replyTo) opts.replyTo.reply('✅ Giveaway terminé.');
}

async function rerollGiveaway(messageId, message) {
  const giveaway = state.giveaways[messageId];
  if (!giveaway || !giveaway.ended) {
    return message.reply("❌ Ce giveaway n'existe pas ou n'est pas encore terminé.");
  }

  const channel = client.channels.cache.get(giveaway.channelId);
  if (!channel) return message.reply('❌ Salon du giveaway introuvable.');

  const { winners } = await pickWinners(channel, messageId, giveaway.winnersCount);
  giveaway.winners = winners;
  saveState(state);

  const winnerChannel = client.channels.cache.get(WINNER_CHANNEL_ID) || channel;

  if (winners.length) {
    await winnerChannel.send(
      `🔁 Nouveau tirage ! Félicitations ${winners.map((id) => `<@${id}>`).join(', ')}, tu as gagné : **${giveaway.prize}** !`
    );
  } else {
    await winnerChannel.send(`😢 Impossible de retirer au sort, personne n'a participé au giveaway **${giveaway.prize}**.`);
  }
}

async function checkGiveaways() {
  const now = Date.now();
  for (const [messageId, giveaway] of Object.entries(state.giveaways)) {
    if (!giveaway.ended && now >= giveaway.endsAt) {
      await endGiveaway(messageId);
    }
  }
}

// ============================================================
// 3ter. SALONS VOCAUX "COMPTEUR" PAR RÔLE
// ============================================================
async function ensureStatsChannels(guild) {
  for (const role of STATS_ROLES) {
    const existingId = state.statsChannels[role.id];
    const existingChannel = existingId ? guild.channels.cache.get(existingId) : null;
    if (existingChannel) continue; // déjà créé

    try {
      const created = await guild.channels.create({
        name: `${role.emoji} ${role.label}: 0`,
        type: 2, // GUILD_VOICE
        parent: STATS_CATEGORY_ID || undefined,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.Connect], // salon "affichage", personne ne peut s'y connecter
          },
        ],
      });
      state.statsChannels[role.id] = created.id;
      saveState(state);
      console.log(`✅ Salon stats créé pour ${role.label} : ${created.id}`);
    } catch (err) {
      console.error(`❌ Erreur création salon stats (${role.label}) :`, err);
    }
  }
}

async function updateStatsChannels(guild, force = false) {
  const now = Date.now();
  if (!force && now - state.lastStatsUpdate < STATS_UPDATE_INTERVAL_MS) return; // évite le rate-limit Discord

  for (const role of STATS_ROLES) {
    const channelId = state.statsChannels[role.id];
    if (!channelId) continue;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;

    const guildRole = guild.roles.cache.get(role.id);
    const count = guildRole ? guildRole.members.size : 0;
    const newName = `${role.emoji} ${role.label}: ${count}`;

    if (channel.name !== newName) {
      try {
        await channel.setName(newName);
      } catch (err) {
        console.error(`❌ Erreur mise à jour salon stats (${role.label}) :`, err);
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
  } catch (err) {
    console.error('❌ Erreur message de bienvenue :', err);
  }
});

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

  if (command === 'giveaway') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return message.reply('❌ Seuls les administrateurs peuvent lancer un giveaway.');
    }

    const durationStr = args.shift();
    const winnersStr = args.shift();
    const prize = args.join(' ');

    await startGiveaway(message, durationStr, winnersStr, prize);
  }

  if (command === 'greroll') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return message.reply('❌ Seuls les administrateurs peuvent utiliser cette commande.');
    }

    const messageId = args.shift();
    if (!messageId) {
      return message.reply(`Utilisation : \`${PREFIX}greroll <message_id>\``);
    }

    await rerollGiveaway(messageId, message);
  }

  if (command === 'gend') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
      return message.reply('❌ Seuls les administrateurs peuvent utiliser cette commande.');
    }

    const messageId = args.shift();
    if (!messageId) {
      return message.reply(`Utilisation : \`${PREFIX}gend <message_id>\``);
    }

    await endGiveaway(messageId, { replyTo: message });
  }
});

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);

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

  // Giveaways : reprend les giveaways en cours (même après un redémarrage) puis vérifie chaque minute
  checkGiveaways();
  setInterval(checkGiveaways, GIVEAWAY_CHECK_INTERVAL_MS);

  // Salons stats par rôle
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    try {
      await guild.members.fetch(); // charge tous les membres pour un comptage précis des rôles
    } catch (err) {
      console.error('❌ Erreur chargement des membres :', err);
    }
    await ensureStatsChannels(guild);
    await updateStatsChannels(guild, true); // première mise à jour immédiate
    setInterval(() => updateStatsChannels(guild), STATS_UPDATE_INTERVAL_MS);
  }
});

// Déclenche une tentative de mise à jour des salons stats (respecte le délai anti rate-limit)
client.on('guildMemberAdd', (member) => updateStatsChannels(member.guild));
client.on('guildMemberRemove', (member) => updateStatsChannels(member.guild));
client.on('guildMemberUpdate', (oldMember, newMember) => updateStatsChannels(newMember.guild));

client.login(process.env.DISCORD_TOKEN);
