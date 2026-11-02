const { Events } = require('discord.js');
const { handleInteraction } = require('../router');

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(ctx, interaction) { await handleInteraction(interaction, ctx); },
};
