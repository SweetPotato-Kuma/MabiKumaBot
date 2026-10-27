// 디스코드 메시지 한 통은 2000자까지라 길어지면 나눠 보낸다. 카드는 한 통에 10장까지다.
const MAX_LENGTH = 1900;
const MAX_EMBEDS = 10;
const ACCENT = 0x9e3563;

export const won = (value) => Number(value).toLocaleString("ko-KR");

const seconds = (ms) => Math.floor(ms / 1000);

/** 디스코드가 "3분 전"처럼 상대 시각으로 그려 주는 표기. */
export const relativeTime = (ms) => `<t:${seconds(ms)}:R>`;

const SETTINGS_HINT = "-# 알림 방식은 /마비쿠마 의 알림 설정에서 바꿀 수 있습니다.";

/** 머리말, 줄 목록, 꼬리말을 길이에 맞게 여러 통으로 나눈다. 줄은 쪼개지 않는다. */
export function chunkMessages(header, lines, footer) {
  const room = MAX_LENGTH - header.length - footer.length - 2;
  const chunks = [];
  let current = [];
  let length = 0;
  for (const line of lines) {
    if (current.length > 0 && length + line.length + 1 > room) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks.map((part) => `${header}\n${part.join("\n")}\n${footer}`);
}

export function arbeitMessages(alert) {
  if (!alert.digest) {
    return alert.entries.map((entry) => `**${entry.label}** 아르바이트를 보고할 수 있습니다.`);
  }
  return chunkMessages(
    "**아르바이트 보고 가능**",
    alert.entries.map((entry) => `• ${entry.label}`),
    SETTINGS_HINT,
  );
}

/**
 * 새 매물이 올라온 저장 검색 하나의 카드. 제목 줄 앞에 아이콘을 작게 붙이고, 누르면 사이트에서 같은 검색이 열린다.
 * 새 매물은 싼 순으로 다섯 개까지 적고 나머지는 개수만 적는다.
 */
export function searchAlertCard(search) {
  const items = search.items.slice(0, 5).flatMap((item, index) => {
    const count = item.count > 1 ? ` ×${won(item.count)}` : "";
    const head = `**${index + 1}.** ${won(item.price)} ${item.name}${count}`;
    return item.notes?.length > 0 ? [head, `　${item.notes.join(" / ")}`] : [head];
  });
  const rest = search.newCount - Math.min(search.items.length, 5);
  return {
    author: {
      name: `${search.name} · 새 매물 ${won(search.newCount)}개`.slice(0, 256),
      url: search.url,
      ...(search.icon ? { icon_url: search.icon } : {}),
    },
    color: ACCENT,
    description: [
      ...(search.conditions?.length > 0 ? [`-# ${search.conditions.join(", ")}`] : []),
      ...items,
      ...(rest > 0 ? [`외 ${won(rest)}개`] : []),
    ]
      .join("\n")
      .slice(0, 4000),
    footer: { text: "넥슨 경매장 기준" },
    timestamp: new Date(search.checkedAt).toISOString(),
  };
}

/** 저장 검색 알림. 묶어 받으면 한 통에 카드 10장까지, 아니면 검색마다 한 통이다. */
export function searchAlertMessages(alert) {
  const cards = alert.searches.map(searchAlertCard);
  if (!alert.digest) return cards.map((card) => ({ embeds: [card] }));
  const messages = [];
  for (let i = 0; i < cards.length; i += MAX_EMBEDS) messages.push({ embeds: cards.slice(i, i + MAX_EMBEDS) });
  return messages;
}
