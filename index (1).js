// Script pour garder le bot CEAXUR en ligne avec un statut personnalisé
// + connexion permanente à un salon vocal dédié
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // nécessaire pour rejoindre un salon vocal
  ]
});

// IDs configurables via variables d'environnement (Railway),
// avec les valeurs actuelles en fallback si les variables ne sont pas définies
const GUILD_ID = process.env.GUILD_ID || '1392549604163321936';
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || '1534683272683192521';

let voiceConnection = null;

function connectToVoiceChannel() {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error(`❌ Serveur introuvable (GUILD_ID: ${GUILD_ID})`);
    return;
  }

  const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!channel) {
    console.error(`❌ Salon vocal introuvable (VOICE_CHANNEL_ID: ${VOICE_CHANNEL_ID})`);
    return;
  }

  voiceConnection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true, // le bot n'a pas besoin d'écouter, économise de la bande passante
    selfMute: true, // il ne parle pas non plus
  });

  console.log(`🔊 Connecté au salon vocal : ${channel.name}`);

  voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('⚠️ Déconnexion détectée, tentative de reconnexion...');
    try {
      await Promise.race([
        entersState(voiceConnection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(voiceConnection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // la connexion se rétablit d'elle-même, rien à faire de plus
    } catch (error) {
      // reconnexion impossible, on nettoie et on retente une connexion complète
      console.error('❌ Reconnexion impossible, nouvelle tentative dans 5s...');
      voiceConnection.destroy();
      setTimeout(connectToVoiceChannel, 5_000);
    }
  });

  voiceConnection.on('error', (error) => {
    console.error('❌ Erreur de connexion vocale :', error);
  });
}

// Watchdog : vérifie toutes les 30 secondes que la connexion vocale est bien active
setInterval(() => {
  if (!voiceConnection || voiceConnection.state.status === VoiceConnectionStatus.Destroyed) {
    console.warn('⚠️ Watchdog : connexion vocale absente, reconnexion...');
    connectToVoiceChannel();
  }
}, 30_000);

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);

  // Statut personnalisé du bot
  client.user.setPresence({
    activities: [{ name: 'ceaxur.ch', type: ActivityType.Watching }],
    status: 'online'
  });

  connectToVoiceChannel();
});

// Le token est lu depuis une variable d'environnement (jamais écrit en dur)
client.login(process.env.DISCORD_TOKEN);
