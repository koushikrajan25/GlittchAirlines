const { MessageFlags, EmbedBuilder } = require('discord.js');
const { authorizeInteraction, DENIED_TITLE, DENIED_TEXT } = require('./access');
const { UserError, AccessError } = require('./errors');
const { brandEmbed, EMBED_COLOR } = require('./embeds');

const deniedPayload = () => ({
  embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle(DENIED_TITLE).setDescription(DENIED_TEXT)],
});

async function replyPrivate(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

const lastDeniedLog = new Map(); 
const cooldowns = new Map();  

async function noteDenied(interaction, access, ctx) {
  try {
    if (!ctx.log || !ctx.db.getSettings().setup_completed) return;
    const last = lastDeniedLog.get(interaction.user.id) ?? 0;
    if (Date.now() - last < 60_000) return;
    lastDeniedLog.set(interaction.user.id, Date.now());
    await ctx.log(brandEmbed('UNAUTHORIZED ATTEMPT').addFields(
      { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Tried to use', value: String(interaction.commandName ?? interaction.customId ?? 'unknown').slice(0, 100), inline: true },
      { name: 'Reason', value: String(access.why) }));
  } catch {  }
}

async function handleInteraction(interaction, ctx) {

  const access = await authorizeInteraction(interaction, ctx.db);
  if (!access.allowed) {
    if (interaction.isAutocomplete?.()) return interaction.respond([]).catch(() => {});
    await replyPrivate(interaction, deniedPayload()).catch(() => {});
    await noteDenied(interaction, access, ctx);
    return;
  }

  try {
    if (interaction.isChatInputCommand?.() || interaction.isContextMenuCommand?.()) {
      const cmd = ctx.commands.get(interaction.commandName);
      if (!cmd) return await replyPrivate(interaction, { content: 'Unknown command.' });

      const key = `${interaction.user.id}:${interaction.commandName}`;
      const wait = (cooldowns.get(key) ?? 0) - Date.now();
      if (wait > 0) return await replyPrivate(interaction, { content: `Slow down, try again in ${Math.ceil(wait / 1000)}s.` });
      cooldowns.set(key, Date.now() + (cmd.cooldownSeconds ?? 3) * 1000);

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await cmd.execute(interaction, { ...ctx, access });
    } else if (interaction.isButton?.() || interaction.isAnySelectMenu?.() || interaction.isModalSubmit?.()) {
      const cmd = ctx.commands.get(String(interaction.customId).split(':')[0]);
      if (!cmd?.handleComponent) return await replyPrivate(interaction, { content: 'This button is no longer valid.' });
      await cmd.handleComponent(interaction, { ...ctx, access });
    }
  } catch (err) {
    if (err instanceof AccessError) return replyPrivate(interaction, deniedPayload()).catch(() => {});
    if (err instanceof UserError) return replyPrivate(interaction, { content: `⚠️ ${err.message}` }).catch(() => {});
    console.error('Command error:', err);
    await replyPrivate(interaction, { content: '❌ Something went wrong. It has been logged for the bot owner.' }).catch(() => {});
  }
}

module.exports = { handleInteraction, deniedPayload };
