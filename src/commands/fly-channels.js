const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');
const { changeSetting } = require('../services/settings');

const MAX_CHANNELS = 10;
const vc = (name, required = false) => (o) => o.setName(name).setDescription(`Voice channel ${name.slice(2)}`).setRequired(required)
  .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice);
const oneVc = (o) => o.setName('channel').setDescription('Voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice);

module.exports = {
  data: new SlashCommandBuilder().setName('f-channels').setDescription('choose vcs')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addSubcommand((s) => s.setName('set').setDescription('Replace the list')
      .addChannelOption(vc('vc1', true)).addChannelOption(vc('vc2', true)).addChannelOption(vc('vc3')).addChannelOption(vc('vc4')).addChannelOption(vc('vc5')))
    .addSubcommand((s) => s.setName('add').setDescription('Add one channel').addChannelOption(oneVc))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove one channel').addChannelOption(oneVc))
    .addSubcommand((s) => s.setName('list').setDescription('channel list'))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove all channels')),

  async execute(interaction, ctx) {
    const { guild, user } = interaction;
    await assertAuthorized(guild, user.id, ctx.db);
    const sub = interaction.options.getSubcommand();
    const current = ctx.db.getSettings().fly_channel_ids;
    const show = (ids) => (ids.length ? ids.map((c) => `<#${c}>`).join(' → ') : 'none');
    const save = (ids, label) => changeSetting({ db: ctx.db, log: ctx.log, userId: user.id, key: 'fly_channel_ids', value: ids, label, shown: show(ids) });
    const me = await guild.members.fetchMe();

    if (sub === 'list') {
      const live = await ctx.fly.liveChannels(guild);
      return interaction.editReply({ embeds: [brandEmbed('FLY CHANNELS').setDescription(show(live.map((c) => c.id)))
        .setFooter({ text: live.length < 2 ? 'You need at least 2 channels before /fly-member works.' : `${live.length} channels` })] });
    }
    if (sub === 'clear') {
      if (!current.length) throw new UserError('The list is already empty.');
      await save([], 'Fly channels (cleared)');
      return interaction.editReply({ content: 'The channel list is now empty.' });
    }
    if (sub === 'set') {
      const ids = [...new Set(['vc1', 'vc2', 'vc3', 'vc4', 'vc5'].map((n) => interaction.options.getChannel(n)).filter(Boolean).map((c) => c.id))];
      if (ids.length < 2) throw new UserError('Pick at least 2 DIFFERENT voice channels.');
      for (const id of ids) await ctx.fly.checkChannel(guild, me, id);
      await save(ids, 'Fly channels');
      return interaction.editReply({ content: `✅ Fly channels: ${show(ids)}` });
    }
    const id = interaction.options.getChannel('channel', true).id;
    if (sub === 'add') {
      if (current.includes(id)) throw new UserError('That channel is already in the list.');
      if (current.length >= MAX_CHANNELS) throw new UserError(`The list can hold at most ${MAX_CHANNELS} channels.`);
      await ctx.fly.checkChannel(guild, me, id);
      await save([...current, id], 'Fly channels (added)');
      return interaction.editReply({ content: `✅ Fly channels: ${show([...current, id])}` });
    }
    // remove
    if (!current.includes(id)) throw new UserError('That channel is not in the list.');
    const next = current.filter((c) => c !== id);
    await save(next, 'Fly channels (removed)');
    return interaction.editReply({ content: `✅ Fly channels: ${show(next)}` });
  },
};
