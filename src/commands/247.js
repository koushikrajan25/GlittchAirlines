const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('247').setDescription('24/7')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addSubcommand((s) => s.setName('set').setDescription('VC set')
      .addChannelOption((o) => o.setName('channel').setDescription('Voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice)))
    .addSubcommand((s) => s.setName('off').setDescription('exit 24/7')),

  async execute(interaction, ctx) {
    const base = { guild: interaction.guild, moderatorId: interaction.user.id };
    if (interaction.options.getSubcommand() === 'set') {
      const channel = await ctx.voiceStay.set({ ...base, channelId: interaction.options.getChannel('channel', true).id });
      return interaction.editReply({ content: `now in <#${channel.id}>` });
    }
    await ctx.voiceStay.off(base);
    return interaction.editReply({ content: '24/7 mode is off.' });
  },
};
