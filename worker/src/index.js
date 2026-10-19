import { runArbeitAlerts, runFavoriteAlerts } from "./alerts.js";
import { handleInteraction } from "./commands.js";
import { readVerifiedBody } from "./verify.js";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env, ctx) {
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

    return json(await handleInteraction(interaction, env, ctx));
  },

  /** 1분마다 깨어나 보고 가능해진 아르바이트와 목표 가격에 닿은 즐겨찾기를 알린다. */
  async scheduled(controller, env, ctx) {
    const run = (name, job) =>
      job(env, controller.scheduledTime).then(
        (summary) => console.log(JSON.stringify({ [name]: summary })),
        (error) => console.error(JSON.stringify({ [name]: String(error?.message ?? error) })),
      );
    ctx.waitUntil(Promise.all([run("arbeit", runArbeitAlerts), run("favorites", runFavoriteAlerts)]));
  },
};
