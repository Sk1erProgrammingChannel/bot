import {
  ApplicationCommandData,
  ApplicationCommand,
  Collection,
  Snowflake,
} from "discord.js";
import { getAllCommands, getCommands } from "@fire/lib/util/commandutil";
import { MessageUtil } from "@fire/lib/ws/util/MessageUtil";
import { getCommitHash } from "@fire/lib/util/gitUtils";
import { EventType } from "@fire/lib/ws/util/constants";
import { FireGuild } from "@fire/lib/extensions/guild";
import { Listener } from "@fire/lib/util/listener";
import { Message } from "@fire/lib/ws/Message";

export default class Ready extends Listener {
  constructor() {
    super("ready", {
      emitter: "client",
      event: "ready",
    });
  }

  async exec() {
    const unavailableGuilds = this.client.guilds.cache.filter(
      (guild) => !guild.available
    );
    if (unavailableGuilds.size) {
      unavailableGuilds.forEach((guild) => {
        this.client.console.warn(
          `[Guilds] Guild ${guild.id} unavailable on connection open`
        );
      });
    }
    try {
      if (typeof process.send == "function") process.send("ready");
      this.client.manager.ws?.send(
        MessageUtil.encode(
          new Message(EventType.READY_CLIENT, {
            avatar: this.client.user.displayAvatarURL({
              size: 4096,
            }),
            allCommands: getAllCommands(this.client),
            commands: getCommands(this.client),
            name: this.client.user.username,
            id: this.client.manager.id,
            env: process.env.NODE_ENV,
            commit: getCommitHash(),
            uuid: process.env.pm_id,
          })
        )
      );
      this.client.manager.ws?.send(
        MessageUtil.encode(
          new Message(
            EventType.DISCOVERY_UPDATE,
            this.client.util.getDiscoverableGuilds()
          )
        )
      );
    } catch {}
    this.client.setReadyPresence();
    this.client.guildSettings.items = this.client.guildSettings.items.filter(
      (value, key) => this.client.guilds.cache.has(key) || key == "0"
    ); // Remove settings for guilds that aren't cached a.k.a guilds that aren't on this cluster
    // or "0" which may be used for something later

    if (process.env.USE_LITECORD || this.client.manager.id != 0) return;

    const appCommands = await this.client.application.commands.fetch();

    if (appCommands?.size) {
      let commands: (ApplicationCommandData & { id?: string })[] = appCommands
        .filter((cmd) => cmd.type != "CHAT_INPUT")
        .toJSON();

      for (const cmd of this.client.commandHandler.modules.values()) {
        if (
          cmd.enableSlashCommand &&
          !cmd.guilds?.length &&
          appCommands.find((s) => s.name == cmd.id)
        )
          commands.push(
            cmd.getSlashCommandJSON(
              appCommands.findKey((s) => s.name == cmd.id)
            )
          );
        else if (cmd.enableSlashCommand && !cmd.guilds?.length)
          commands.push(cmd.getSlashCommandJSON());
      }

      const updated = await this.client.application.commands
        .set(commands)
        .catch((e: Error) => {
          this.client.console.error(
            `[Commands] Failed to update slash commands\n${e.stack}`
          );
          return new Collection<Snowflake, ApplicationCommand>();
        });
      if (updated && updated.size)
        this.client.console.info(
          `[Commands] Successfully bulk updated ${updated.size} slash commands`
        );
    }
  }
}
