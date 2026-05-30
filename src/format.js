export function formatGold(value) {
  return `${Math.round(value).toLocaleString("ko-KR")} 골드`;
}

export function formatPercent(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatDateTime(date) {
  if (!date) {
    return "없음";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(date);
}

export function formatItemList(items) {
  if (items.length === 0) {
    return "등록된 아이템이 없습니다.";
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

