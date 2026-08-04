// Script minimal pour garder le bot CEAXUR en ligne avec un statut personnalisé
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);

  // Statut personnalisé du bot — change le texte ici si tu veux
  client.user.setPresence({
    activities: [{ name: 'ceaxur.ch', type: ActivityType.Watching }],
    status: 'online' // options possibles : 'online', 'idle', 'dnd'
  });
});

// Le token est lu depuis une variable d'environnement (jamais écrit en dur ici, pour la sécurité)
client.login(process.env.DISCORD_TOKEN);
