// 디스코드 메시지 한 통은 2000자까지라 길어지면 나눠 보낸다.
const MAX_LENGTH = 1900;

export const won = (value) => Number(value).toLocaleString("ko-KR");

const seconds = (ms) => Math.floor(ms / 1000);

/** 디스코드가 "3분 전"처럼 상대 시각으로 그려 주는 표기. */
export const relativeTime = (ms) => `<t:${seconds(ms)}:R>`;

export const dataNote = (ms) => `-# 넥슨 경매장 기준 ${relativeTime(ms)}`;

const SETTINGS_HINT = "-# 알림 방식은 /구마 알림설정 에서 바꿀 수 있습니다.";

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

const link = (label, url) => `[${label}](<${url}>)`;

function favoriteLine(item) {
  return `• ${link(item.name, item.links.item)} 최저 **${won(item.price)}** (목표 ${won(item.target)}) · 매물 ${won(item.listings)}개 · ${link("경매장", item.links.auction)}`;
}

export function favoriteAlertMessages(alert) {
  const checkedAt = Math.max(...alert.items.map((item) => item.checkedAt));
  if (!alert.digest) {
    return alert.items.map(
      (item) => `**목표 가격 도달**\n${favoriteLine(item)}\n${dataNote(item.checkedAt)}`,
    );
  }
  return chunkMessages(
    "**목표 가격 도달**",
    alert.items.map(favoriteLine),
    `${dataNote(checkedAt)}\n${SETTINGS_HINT}`,
  );
}

/** `/구마 즐겨찾기 목록` 응답. 항목이 많으면 줄이 길어지지 않게 링크를 뺀다. */
export function favoritesStatusMessages(status) {
  if (status.items.length === 0) {
    return ["즐겨찾기가 없습니다. `/구마 즐겨찾기 추가`로 아이템을 고르세요."];
  }
  const withLinks = status.items.length <= 8;
  const lines = status.items.map((item) => {
    const name = withLinks ? link(item.name, item.links.item) : item.name;
    const price = item.unavailable
      ? "최저가를 읽지 못했습니다"
      : item.lowest.price === null
        ? "매물 없음"
        : `최저 **${won(item.lowest.price)}** (매물 ${won(item.lowest.listings)}개)`;
    const parts = [price];
    if (item.day) parts.push(`24시간 중위 ${won(item.day.mid)}`);
    if (item.targetPrice) {
      const reached = item.lowest?.price != null && item.lowest.price <= item.targetPrice;
      parts.push(`목표 ${won(item.targetPrice)}${reached ? " 이하" : ""}`);
    }
    return `• ${name} ${parts.join(" · ")}`;
  });
  return chunkMessages(`**내 즐겨찾기** (${lines.length}개)`, lines, dataNote(status.checkedAt));
}

export function marketText(summary) {
  const lines = [`**${summary.name}**`];
  if (summary.lowest?.price != null) {
    lines.push(`현재 최저가 **${won(summary.lowest.price)}** (매물 ${won(summary.lowest.listings)}개) ${relativeTime(summary.lowest.checkedAt)}`);
  } else if (summary.lowest) {
    lines.push("현재 등록된 매물이 없습니다.");
  }
  if (summary.day) {
    const d = summary.day;
    lines.push(
      `최근 24시간 거래 ${won(d.n)}건 · 수량 ${won(d.qty)}`,
      `중위가 **${won(d.mid)}** · 평균 ${won(d.avg)} · 최저 ${won(d.lo)} · 최고 ${won(d.hi)}`,
    );
  } else {
    lines.push("최근 24시간 거래가 없습니다.");
  }
  if (summary.series.length > 0) {
    lines.push(
      `최근 7일 중위가: ${summary.series.map((day) => `${day.date.slice(5)} ${won(day.mid)}`).join(" · ")}`,
    );
  }
  lines.push("-# 거래 기록은 최대 10분 늦을 수 있습니다.");
  return lines.join("\n");
}
