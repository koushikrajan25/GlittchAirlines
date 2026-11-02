const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('typing').setDescription('typing indi')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addSubcommand((s) => s.setName('set').setDescription('Choose the default channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Text channel').setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('off').setDescription('Stop')),

  async execute(interaction, ctx) {
    const base = { guild: interaction.guild, moderatorId: interaction.user.id };
    if (interaction.options.getSubcommand() === 'set') {
      const channel = await ctx.typing.set({ ...base, channelId: interaction.options.getChannel('channel', true).id });
      return interaction.editReply({ content: `I will show "is typing..." in <#${channel.id}> and never send a message.` });
    }
    await ctx.typing.off(base);
    return interaction.editReply({ content: 'The typing indicator is off.' });
  },
};
