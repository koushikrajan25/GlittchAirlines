const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');
const { changeSetting } = require('../services/settings');
const { renderText } = require('../services/announce');

module.exports = {
  data: new SlashCommandBuilder().setName('f-ann').setDescription('announcement')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addSubcommand((s) => s.setName('image').setDescription('Set the announcement image')
      .addAttachmentOption((o) => o.setName('file').setDescription('up to 8 MB').setRequired(true)))
    .addSubcommand((s) => s.setName('image-remove').setDescription('Remove the announcement image'))
    .addSubcommand((s) => s.setName('text').setDescription('Set the message')
      .addStringOption((o) => o.setName('message').setDescription('embed msg').setRequired(true).setMaxLength(300)))
    .addSubcommand((s) => s.setName('channel').setDescription('Where to post it (vc chat will not work)')
      .addChannelOption((o) => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('toggle').setDescription('announcement on or off')
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('Test announcement')),

  async execute(interaction, ctx) {
    const { guild, user } = interaction;
    await assertAuthorized(guild, user.id, ctx.db);
    const o = interaction.options;
    const sub = o.getSubcommand();
    const change = async (key, value, label, shown) => {
      await changeSetting({ db: ctx.db, log: ctx.log, userId: user.id, key, value, label, shown });
      return interaction.editReply({ content: `${label} → ${shown}` });
    };

    switch (sub) {
      case 'image': {
        await ctx.announce.setImage({ guild, moderatorId: user.id, attachment: o.getAttachment('file', true) });
        const img = ctx.announce.imageFile();
        return interaction.editReply({ content: 'Announcement image saved. Here it is:', files: img ? [img.path] : [] });
      }
      case 'image-remove':
        await ctx.announce.removeImage({ guild, moderatorId: user.id });
        return interaction.editReply({ content: 'The announcement image was removed.' });
      case 'text': {
        const text = o.getString('message', true).trim();
        if (!text) throw new UserError('The message cannot be empty.');
        return change('announce_text', text, 'Announcement text', text);
      }
      case 'channel': {
        const ch = o.getChannel('channel');
        if (!ch) return change('announce_channel_id', null, 'Announcement channel', 'the channel where /fly-member is used');
        await ctx.announce.checkChannel(guild, ch.id);
        return change('announce_channel_id', ch.id, 'Announcement channel', `<#${ch.id}>`);
      }
      case 'toggle': return change('announce_enabled', o.getBoolean('enabled', true), 'Announcement', o.getBoolean('enabled') ? 'ON' : 'OFF');
      case 'view': {
        const s = ctx.db.getSettings();
        const sample = { user_id: user.id, started_at: 0, expires_at: s.default_duration_ms, interval_ms: s.default_interval_seconds * 1000 };
        const img = ctx.announce.imageFile();
        return interaction.editReply({
          embeds: [brandEmbed('FLIGHT ANNOUNCEMENT').addFields(
            { name: 'Status', value: s.announce_enabled ? 'ON' : 'OFF', inline: true },
            { name: 'Posted in', value: s.announce_channel_id ? `<#${s.announce_channel_id}>` : 'where /fly-member is used', inline: true },
            { name: 'Picture', value: img ? 'set (shown below)' : 'none yet — use `/fly-announce image`', inline: true },
            { name: 'Preview of the message', value: renderText(s.announce_text, { userId: user.id, durationMs: sample.expires_at, intervalMs: sample.interval_ms }).slice(0, 1000) })],
          files: img ? [img.path] : [],
        });
      }
    }
  },
};
