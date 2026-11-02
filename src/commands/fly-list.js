const { SlashCommandBuilder } = require('discord.js');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('fly-list').setDescription('list everyone currently flying')
    .setDefaultMemberPermissions(0).setDMPermission(false),

  async execute(interaction, ctx) {
    await assertAuthorized(interaction.guild, interaction.user.id, ctx.db); // second check
    const rows = ctx.db.listActiveFly().slice(0, 20).map((f) =>
      `<@${f.user_id}> — ${JSON.parse(f.channels).length} channels, every ${Math.round(f.interval_ms / 1000)}s, ${f.moves} moves, ends <t:${Math.floor(f.expires_at / 1000)}:R>`);
    await interaction.editReply({ embeds: [brandEmbed('ACTIVE FLIES').setDescription(rows.join('\n') || 'Nobody is being flown right now.')] });
  },
};
