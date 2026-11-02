const { Events } = require('discord.js');
const { startScheduler } = require('../services/scheduler');
const { brandEmbed } = require('../embeds');
const { BOT_NAME } = require('../brand');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(ctx, client) {
    console.log(`Logged in as ${client.user.tag}`);
    if (!ctx.db.hasSetting('timezone')) ctx.db.setSetting('timezone', ctx.defaultTimezone);

    try {
      const guild = await client.guilds.fetch(ctx.envGuildId);
      const roles = await guild.roles.fetch();
      if (!roles.has(ctx.db.getSettings().authorized_role_id)) {
        console.warn('WARNING: AUTHORIZED_ROLE_ID in .env is not a role in your server. Everyone will be denied until you fix it.');
      }
    } catch (e) { console.warn('Could not check the role ID:', e.message); }

    try {
      const guild = await client.guilds.fetch(ctx.envGuildId);
      const me = await guild.members.fetchMe();
      if (me.displayName !== BOT_NAME) await me.setNickname(BOT_NAME, 'Bot display name');
    } catch (e) { console.warn(`Could not set my server nickname (give me "Change Nickname", or set the name in the Developer Portal): ${e.message}`); }

    const active = ctx.db.listActiveFly().length;  
    startScheduler(ctx);
    ctx.voiceStay.ensure();   
    ctx.typing.tick();      
    console.log(`Schedulers are running (fly, 24/7 voice, typing). ${active} active fly job(s) resumed.`);
    if (active) await ctx.log(brandEmbed('BACK ONLINE').addFields({ name: 'Fly jobs resumed', value: String(active), inline: true }));
  },
};
