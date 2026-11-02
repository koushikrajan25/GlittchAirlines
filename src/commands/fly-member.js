const { SlashCommandBuilder } = require('discord.js');
const { UserError } = require('../errors');
const { parseDuration } = require('../utils');
const { MIN_INTERVAL, MAX_INTERVAL } = require('../services/fly');

module.exports = {
  data: new SlashCommandBuilder().setName('fly').setDescription('poitu va mamae bye..')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('memb').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('How long:'))
    .addIntegerOption((o) => o.setName('interval_seconds').setDescription('interval btw')
      .setMinValue(MIN_INTERVAL).setMaxValue(MAX_INTERVAL)),

  async execute(interaction, ctx) {
    const d = interaction.options.getString('duration');
    const durationMs = d ? parseDuration(d) : undefined;
    if (d && !durationMs) throw new UserError('Duration must look like `10m`, `1h` or `2h`.');

    const fly = await ctx.fly.startFly({
      guild: interaction.guild, moderatorId: interaction.user.id,
      targetUserId: interaction.options.getUser('member', true).id,
      durationMs, intervalSec: interaction.options.getInteger('interval_seconds') ?? undefined,
    });
    let note = 'ℹ️ Moves only happen while the member is in a voice channel.';
    try {
      await ctx.announce.announceFlight({ guild: interaction.guild, fly, fallbackChannelId: interaction.channelId });
    } catch (err) {
      if (!(err instanceof UserError)) console.error('Announcement failed:', err);
      note += `\n⚠️ The fly started, but the announcement could not be posted: ${err instanceof UserError ? err.message : 'unexpected error (see the console).'}`;
    }
    await interaction.editReply({ content: note, embeds: [ctx.fly.flyEmbed('FLY STARTED', fly)] });
  },
};
