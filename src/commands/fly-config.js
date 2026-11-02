const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');
const { changeSetting } = require('../services/settings');
const { parseDuration, formatDuration, DAY } = require('../utils');

const durOpt = (o) => o.setName('duration').setDescription('Like 10m, 1h, 1d').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder().setName('f-config').setDescription('configuration')
    .setDefaultMemberPermissions(0).setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('Show ALL settings in one embed'))
    .addSubcommand((s) => s.setName('log-channel').setDescription('log channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Text channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('default-duration').setDescription('How long a fly lasts').addStringOption(durOpt))
    .addSubcommand((s) => s.setName('max-duration').setDescription('The longest a fly last').addStringOption(durOpt))
    .addSubcommand((s) => s.setName('timezone').setDescription('Display timezone')
      .addStringOption((o) => o.setName('name').setDescription('Timezone name').setRequired(true))),

  async execute(interaction, ctx) {
    await assertAuthorized(interaction.guild, interaction.user.id, ctx.db);
    const { db } = ctx;
    const o = interaction.options;
    const s = db.getSettings();
    const change = async (key, value, label, shown) => {
      await changeSetting({ db, log: ctx.log, userId: interaction.user.id, key, value, label, shown });
      await interaction.editReply({ content: `✅ ${label} → ${shown}` });
    };
    const durationOf = () => {
      const ms = parseDuration(o.getString('duration', true));
      if (!ms) throw new UserError('Use a duration like `10m`, `1h` or `1d`.');
      return ms;
    };

    switch (o.getSubcommand()) {
      case 'view': {
  
        const ch = (id) => (id ? `<#${id}>` : 'not set');
        const img = ctx.announce.imageFile();
        const chans = s.fly_channel_ids.map((c) => `<#${c}>`).join(' → ') || 'none (use `/fly-channels set`)';
        return interaction.editReply({ embeds: [brandEmbed('BOT SETTINGS').addFields(
          { name: 'Authorized role (from .env)', value: s.authorized_role_id ? `<@&${s.authorized_role_id}>` : 'not set', inline: true },
          { name: 'Log channel', value: ch(s.log_channel_id), inline: true },
          { name: 'Timezone', value: s.timezone, inline: true },
          { name: 'Fly channels', value: chans },
          { name: 'Default interval', value: `${s.default_interval_seconds}s`, inline: true },
          { name: 'Default / max duration', value: `${formatDuration(s.default_duration_ms)} / ${formatDuration(s.max_duration_ms)}`, inline: true },
          { name: 'Active flies', value: String(db.listActiveFly().length), inline: true },
          { name: 'Flight announcement', value: `${s.announce_enabled ? 'ON' : 'OFF'} • posted in ${s.announce_channel_id ? ch(s.announce_channel_id) : 'the channel where /fly-member is used'} • picture: ${img ? 'set' : 'none'}` },
          { name: '24/7 voice channel', value: ch(s.stay_vc_id), inline: true },
          { name: 'Typing channel', value: ch(s.typing_channel_id), inline: true })] });
      }
      case 'log-channel': return change('log_channel_id', o.getChannel('channel', true).id, 'Log channel', `<#${o.getChannel('channel').id}>`);
      case 'default-duration': {
        const ms = durationOf();
        if (ms > s.max_duration_ms) throw new UserError('The default cannot be longer than the maximum.');
        return change('default_duration_ms', ms, 'Default duration', formatDuration(ms));
      }
      case 'max-duration': {
        const ms = durationOf();
        if (ms > 7 * DAY) throw new UserError('The maximum cannot be over 7 days.');
        if (ms < s.default_duration_ms) throw new UserError('The maximum cannot be shorter than the default duration.');
        return change('max_duration_ms', ms, 'Maximum duration', formatDuration(ms));
      }
      case 'timezone': {
        const tz = o.getString('name', true).trim();
        try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new UserError('That is not a valid timezone name (example: `UTC`, `Asia/Kolkata`).'); }
        return change('timezone', tz, 'Display timezone', tz);
      }
    }
  },
};
