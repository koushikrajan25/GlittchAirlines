const { SlashCommandBuilder } = require('discord.js');
const { assertAuthorized } = require('../access');
const { changeSetting } = require('../services/settings');
const { MIN_INTERVAL, MAX_INTERVAL } = require('../services/fly');

module.exports = {
  data: new SlashCommandBuilder().setName('f-interval').setDescription('Set the default interval')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addIntegerOption((o) => o.setName('seconds').setDescription(`Seconds between moves (${MIN_INTERVAL}-${MAX_INTERVAL})`)
      .setRequired(true).setMinValue(MIN_INTERVAL).setMaxValue(MAX_INTERVAL)),

  async execute(interaction, ctx) {
    await assertAuthorized(interaction.guild, interaction.user.id, ctx.db);
    const seconds = interaction.options.getInteger('seconds', true);
    await changeSetting({ db: ctx.db, log: ctx.log, userId: interaction.user.id, key: 'default_interval_seconds', value: seconds, label: 'Default interval', shown: `${seconds}s` });
    await interaction.editReply({ content: `✅ Default interval is now ${seconds}s. (Flies already running keep their own interval.)` });
  },
};
