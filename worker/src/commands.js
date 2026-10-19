import { erinClock, formatErinClock, formatShopReset, msUntilShopReset } from "./erin.js";

const SUBCOMMAND = 1;
const CHAT_INPUT = 1;
const CHANNEL_MESSAGE = 4;
const EPHEMERAL = 64;

/** 디스코드에 등록하는 명령 정의. 루트 명령 `/구마` 하나에 서브명령을 모은다. */
export const COMMANDS = [
  {
    type: CHAT_INPUT,
    name: "구마",
    description: "마비노기 도우미",
    options: [
      {
        type: SUBCOMMAND,
        name: "에린",
        description: "지금 에린 시각과 상점이 바뀔 때까지 남은 시간",
      },
    ],
  },
];

function reply(content, { ephemeral = false } = {}) {
  return {
    type: CHANNEL_MESSAGE,
    data: { content, ...(ephemeral ? { flags: EPHEMERAL } : {}) },
  };
}

function erinReply(now) {
  const clock = erinClock(now);
  const phase = clock.day ? "낮" : "밤";
  return reply(
    `에린 시각 **${formatErinClock(clock)}** (${phase})\n다음 상점 교체까지 **${formatShopReset(msUntilShopReset(now))}**`,
  );
}

export function handleCommand(interaction, now = Date.now()) {
  const name = interaction?.data?.name;
  const sub = interaction?.data?.options?.find((option) => option.type === SUBCOMMAND)?.name;

  if (name === "구마" && sub === "에린") {
    return erinReply(now);
  }
  return reply("아직 지원하지 않는 명령입니다.", { ephemeral: true });
}
