import { handleCommand } from "./commands.js";
import { readVerifiedBody } from "./verify.js";

const PING = 1;
const APPLICATION_COMMAND = 2;
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

    if (interaction.type === PING) {
      return json({ type: PONG });
    }
    if (interaction.type === APPLICATION_COMMAND) {
      return json(handleCommand(interaction));
    }
    return json({ type: 4, data: { content: "아직 지원하지 않는 동작입니다.", flags: 64 } });
  },
};
