function makeLogger(client, db) {
  return async function log(embed) {
    try {
      const id = db.getSettings().log_channel_id;
      if (!id) return;
      const channel = await client.channels.fetch(id);
      if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
    } catch (err) {
      console.warn('Could not write to the log channel:', err.message);
    }
  };
}
module.exports = { makeLogger };
