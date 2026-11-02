const { AccessError } = require('./errors');
const { BOT_NAME } = require('./brand');

const DENIED_TITLE = 'ACCESS DENIED';
const DENIED_TEXT = `You do not have the authorized role required to use ${BOT_NAME}.`;


function decideAccess({ settings, guildId, memberRoleIds, roleExists }) {
  const deny = (why) => ({ allowed: false, why });
  if (!settings) return deny('config_unavailable');
  if (!settings.setup_completed) return deny('not_set_up');
  if (!settings.guild_id || guildId !== settings.guild_id) return deny('wrong_guild');   
  if (!roleExists) return deny('role_missing');                                           
  if (Array.isArray(memberRoleIds) && memberRoleIds.includes(settings.authorized_role_id)) return { allowed: true };
  return deny('missing_role');
}

async function authorizeInteraction(interaction, db) {
  try {
    const settings = db.getSettings();
    let roleExists = false;
    let memberRoleIds = [];
    if (interaction.guild) {
      if (settings.setup_completed && settings.authorized_role_id) {
        roleExists = !!(await interaction.guild.roles.fetch(settings.authorized_role_id));
      }
      const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
      memberRoleIds = [...member.roles.cache.keys()];
    }
    return decideAccess({ settings, guildId: interaction.guildId, memberRoleIds, roleExists });
  } catch (err) {
    console.error('Access check failed, denying (fail closed):', err.message);
    return { allowed: false, why: 'error' };
  }
}

async function assertAuthorized(guild, userId, db) {
  const s = db.getSettings();
  if (!s.setup_completed || !s.authorized_role_id || s.guild_id !== guild.id) throw new AccessError(DENIED_TEXT);
  const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
  if (!member || !member.roles.cache.has(s.authorized_role_id)) throw new AccessError(DENIED_TEXT);
}

module.exports = { decideAccess, authorizeInteraction, assertAuthorized, DENIED_TITLE, DENIED_TEXT };
