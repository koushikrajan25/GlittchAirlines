const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('f-stop').setDescription('Stop')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('if specific memb')),

  async execute(interaction, ctx) {
    const base = { guild: interaction.guild, moderatorId: interaction.user.id };
    const user = interaction.options.getUser('member');
    if (user) {
      const fly = await ctx.fly.stopFly({ ...base, userId: user.id });
      return interaction.editReply({ embeds: [ctx.fly.flyEmbed('FLY STOPPED', fly)] });
    }
    const n = await ctx.fly.stopAll(base);
    return interaction.editReply({ content: ` Stopped ${n} fly job(s).` });
  },
};
