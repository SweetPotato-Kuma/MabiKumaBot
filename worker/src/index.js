import { runArbeitAlerts } from "./alerts.js";
import { handleAutocomplete, handleCommand, handleComponent } from "./commands.js";
import { readVerifiedBody } from "./verify.js";

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const AUTOCOMPLETE = 4;
const PONG = 1;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    }

    const body = await readVerifiedBody(request, env.DISCORD_PUBLIC_KEY);
    if (body === null) {
      return new Response("Invalid request signature", { status: 401 });
    }

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    switch (interaction.type) {
      case PING:
        return json({ type: PONG });
      case APPLICATION_COMMAND:
        return json(await handleCommand(interaction, env));
      case MESSAGE_COMPONENT:
        return json(await handleComponent(interaction, env));
      case AUTOCOMPLETE:
        return json(await handleAutocomplete(interaction, env));
      default:
        return json({ type: 4, data: { content: "아직 지원하지 않는 동작입니다.", flags: 64 } });
    }
  },

  /** 1분마다 깨어나 지난 1분 사이에 보고 가능해진 아르바이트를 알린다. */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runArbeitAlerts(env, controller.scheduledTime).then(
        (summary) => console.log(JSON.stringify({ arbeit: summary })),
        (error) => console.error(JSON.stringify({ arbeit: String(error?.message ?? error) })),
      ),
    );
  },
};
