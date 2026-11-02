const { EmbedBuilder } = require('discord.js');
const { BOT_NAME } = require('./brand');

const EMBED_COLOR = 0x000001;

function brandEmbed(title) {
  return new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title).setFooter({ text: BOT_NAME }).setTimestamp();
}
module.exports = { EMBED_COLOR, brandEmbed };
