import { runArbeitAlerts, runSearchAlerts } from "./alerts.js";
import { runDailyAlerts } from "./daily.js";
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

  /**
   * 1분마다 깨어나 보고 가능해진 아르바이트와 목표 가격에 닿은 저장 검색을 알린다.
   * 한 번의 실행이 길어지면 뒤의 예약 실행이 수십 분씩 밀려 아르바이트 알림이 늦게 간다(2026-10-26 확인).
   * 그래서 아르바이트를 먼저 끝내고, 넥슨을 읽는 저장 검색은 정해진 시간 안에서만 기다린다.
   */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
};

export const SEARCH_BUDGET_MS = 25_000;

export async function runScheduled(env, scheduledTime, budgetMs = SEARCH_BUDGET_MS) {
  const run = (name, job) =>
    job(env, scheduledTime).then(
      (summary) => console.log(JSON.stringify({ [name]: summary })),
      (error) => console.error(JSON.stringify({ [name]: String(error?.message ?? error) })),
    );
  await run("arbeit", runArbeitAlerts);
  await run("daily", runDailyAlerts);
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(JSON.stringify({ searches: `${budgetMs}ms 안에 끝나지 않아 다음 실행으로 넘김` }));
      resolve();
    }, budgetMs);
  });
  await Promise.race([run("searches", runSearchAlerts), deadline]);
  clearTimeout(timer);
}
