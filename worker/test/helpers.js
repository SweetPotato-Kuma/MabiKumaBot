import { handleInteraction } from "../src/commands.js";

export const ALICE = "111111111111111111";
export const BOB = "222222222222222222";
export const NOW = Date.parse("2026-10-19T14:20:00+09:00");

/** 두 개의 선택 메뉴로 나뉘도록 15개를 넘기는 시간표. 실제 시간표와 모양이 같다. */
export const ENTRIES = Array.from({ length: 20 }, (_, i) => ({
  id: `entry-${i}`,
  group: `묶음${Math.floor(i / 5)}`,
  label: `항목 ${i}`,
  report: 9 + (i % 12),
  verified: false,
}));

const links = (name) => ({
  item: `https://mabi.spkuma.com/item/${name}?ref=bot`,
  auction: `https://mabi.spkuma.com/auction?keyword=${name}&exact=1&ref=bot`,
});

export function summary(name, { price = 4290, mid = 4200 } = {}) {
  return {
    name,
    day: { n: 100, qty: 200, lo: 1, hi: 9, mid, avg: mid },
    series: [{ date: "2026-10-19", mid }],
    lowest: { price, listings: 3, checkedAt: NOW - 60_000 },
    links: links(name),
  };
}

/** 사이트 Worker 의 BotService 를 흉내 낸다. 계약은 사이트 저장소의 테스트가 확인한다. */
export function fakeSite() {
  const users = new Map();
  const favorites = new Map();
  const calls = [];
  const site = {
    calls,
    users,
    favorites,
    items: [],
    summaries: {},
    due: [],
    favoriteDue: [],
    fail: null,
    async getUser(id) {
      if (site.fail) throw site.fail;
      return users.get(id) ?? null;
    },
    async registerUser(id, version) {
      calls.push(["registerUser", id, version]);
      users.set(id, {
        id,
        consentVersion: version,
        consentedAt: NOW,
        settings: { digest: true, paused: false, quiet: null, dmChannelId: null, disabledReason: null },
        arbeit: [],
      });
    },
    async deleteUser(id) {
      calls.push(["deleteUser", id]);
      users.delete(id);
      favorites.delete(id);
    },
    async updateSettings(id, patch) {
      calls.push(["updateSettings", id, patch]);
      const user = users.get(id);
      user.settings = { ...user.settings, ...patch };
      return user.settings;
    },
    async markDmFailed(id) {
      calls.push(["markDmFailed", id]);
    },
    async changeArbeitSubs(id, change) {
      calls.push(["changeArbeitSubs", id, change]);
      const user = users.get(id);
      const set = new Set(user.arbeit);
      if (change.all) ENTRIES.forEach((entry) => set.add(entry.id));
      if (change.none) set.clear();
      (change.add ?? []).forEach((entry) => set.add(entry));
      (change.remove ?? []).forEach((entry) => set.delete(entry));
      user.arbeit = ENTRIES.map((entry) => entry.id).filter((entry) => set.has(entry));
      return user.arbeit;
    },
    async listArbeitEntries() {
      return ENTRIES;
    },
    async searchItems(query) {
      return site.items.filter((name) => name.startsWith(query));
    },
    async marketSummary(name) {
      calls.push(["marketSummary", name]);
      return site.summaries[name] ?? null;
    },
    async listFavorites(id) {
      return favorites.get(id) ?? [];
    },
    async addFavorite(id, name, target) {
      calls.push(["addFavorite", id, name, target]);
      if (name === "너무많음") throw new Error("즐겨찾기는 20개까지 둘 수 있습니다.");
      const list = favorites.get(id) ?? [];
      const found = list.find((favorite) => favorite.name === name);
      if (found) {
        if (target !== undefined) found.targetPrice = target || null;
      } else {
        list.push({ name, targetPrice: target || null });
      }
      favorites.set(id, list);
      return list;
    },
    async removeFavorite(id, name) {
      calls.push(["removeFavorite", id, name]);
      favorites.set(id, (favorites.get(id) ?? []).filter((favorite) => favorite.name !== name));
    },
    async favoritesStatus(id) {
      calls.push(["favoritesStatus", id]);
      return {
        checkedAt: NOW,
        items: (favorites.get(id) ?? []).map((favorite) => ({
          name: favorite.name,
          targetPrice: favorite.targetPrice,
          lowest: { price: 4290, listings: 3 },
          unavailable: false,
          day: { mid: 4200 },
          links: links(favorite.name),
        })),
      };
    },
    async dueArbeitAlerts(from, to) {
      calls.push(["dueArbeitAlerts", from, to]);
      return site.due;
    },
    async dueFavoriteAlerts(minuteIndex) {
      calls.push(["dueFavoriteAlerts", minuteIndex]);
      return site.favoriteDue;
    },
  };
  return site;
}

// ---------- 디스코드 상호작용 만들기 ----------
const base = (type, user) => ({ type, token: "interaction-token", member: { user: { id: user } } });

export const slash = (values = {}, user = ALICE) => ({
  ...base(2, user),
  data: {
    name: "마비쿠마",
    options: Object.entries(values).map(([name, value]) => ({ type: 3, name, value })),
  },
});

export const click = (customId, values, user = ALICE) => ({
  ...base(3, user),
  data: { custom_id: customId, ...(values ? { values } : {}) },
});

export const submit = (customId, fields, user = ALICE) => ({
  ...base(5, user),
  data: {
    custom_id: customId,
    components: Object.entries(fields).map(([id, value]) => ({
      type: 1,
      components: [{ type: 4, custom_id: id, value }],
    })),
  },
});

export const typing = (value, user = ALICE) => ({
  ...base(4, user),
  data: { name: "마비쿠마", options: [{ type: 3, name: "아이템", value, focused: true }] },
});

// ---------- 결과 읽기 ----------
/** 모든 단추와 메뉴를 한 줄로 펼친다. */
export const componentsOf = (view) => (view?.components ?? []).flatMap((row) => row.components);
export const find = (view, customId) => componentsOf(view).find((component) => component.custom_id === customId);
export const ids = (view) => componentsOf(view).map((component) => component.custom_id ?? component.url);

/**
 * 상호작용을 처리하고 결과를 돌려준다. 처리 중으로 먼저 답한 화면은 원래 메시지를 고친 내용(edit)을 함께 준다.
 * 디스코드에 보내는 요청(fetch)은 가로채 기록한다.
 */
export async function run(site, interaction, { now = NOW, fetchReply } = {}) {
  const real = globalThis.fetch;
  const edits = [];
  globalThis.fetch = async (url, init) => {
    edits.push({ url: String(url), body: JSON.parse(init.body) });
    return fetchReply ? fetchReply(String(url)) : new Response("{}", { status: 200 });
  };
  try {
    const initial = await handleInteraction(interaction, { SITE: site, DISCORD_APPLICATION_ID: "app" }, undefined, now);
    return { initial, view: initial.data, edit: edits.at(-1)?.body, edits };
  } finally {
    globalThis.fetch = real;
  }
}
