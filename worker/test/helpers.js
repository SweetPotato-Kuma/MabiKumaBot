import { handleInteraction } from "../src/commands.js";

export const ALICE = "111111111111111111";
export const BOB = "222222222222222222";
export const NOW = Date.parse("2026-10-20T14:20:00+09:00");

/**
 * 실제 시간표와 모양이 같은 시간표. 앞의 세 묶음은 항목이 둘씩이고 나머지는 하나씩, 모두 23묶음이라 두 쪽으로 나뉜다.
 * 앞쪽 항목만 모집 시간이 있다.
 */
export const ENTRIES = Array.from({ length: 26 }, (_, i) => ({
  id: `entry-${i}`,
  group: `묶음${i < 6 ? Math.floor(i / 2) : i - 3}`,
  label: `항목 ${i}`,
  report: 9 + (i % 12),
  ...(i < 6 ? { recruit: [7, 19] } : {}),
  verified: false,
}));

const searchResult = (query) => {
  const ready = Boolean(query.keyword || query.category);
  return {
    query,
    conditions: [],
    ready,
    total: ready ? 1 : 0,
    scanned: 1,
    truncated: false,
    checkedAt: NOW,
    lowest: ready ? 4290 : null,
    items: ready ? [{ name: "낙지", itemName: "낙지", price: 4290, count: 1, notes: [] }] : [],
  };
};

/** 사이트 Worker 의 BotService 를 흉내 낸다. 계약은 사이트 저장소의 테스트가 확인한다. */
export function fakeSite() {
  const users = new Map();
  const searches = new Map();
  const calls = [];
  let nextId = 1;
  const site = {
    calls,
    users,
    searches,
    items: [],
    due: [],
    searchDue: [],
    fail: null,
    linked: false,
    importResult: { added: [], existing: 0, invalid: 0, full: 0 },
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
      searches.delete(id);
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
      return null;
    },
    async linkStatus() {
      return { linked: site.linked };
    },
    async createLinkCode(id) {
      calls.push(["createLinkCode", id]);
      return { code: "ABCD-EFGH", expiresAt: NOW + 600_000 };
    },
    async unlinkDiscord(id) {
      calls.push(["unlinkDiscord", id]);
      site.linked = false;
      return { unlinked: true };
    },
    async importSiteSearches(id) {
      calls.push(["importSiteSearches", id]);
      return site.importResult;
    },
    async searchAuction(query, options) {
      calls.push(["searchAuction", query, options]);
      if (site.searchError) throw site.searchError;
      return searchResult(query);
    },
    async searchCatalog(query) {
      calls.push(["searchCatalog", query]);
      return { query, conditions: [], entries: [] };
    },
    async addSearchCondition(query, spec) {
      calls.push(["addSearchCondition", query, spec]);
      return { ...query, filterKey: "f" };
    },
    async removeSearchCondition(query, index) {
      calls.push(["removeSearchCondition", query, index]);
      return { ...query, filterKey: "" };
    },
    async categoryTree() {
      return [{ name: "근거리 장비", key: "group:근거리 장비", categories: ["검"] }];
    },
    async listSearches(id) {
      return (searches.get(id) ?? []).map((search) => ({ ...search }));
    },
    async saveSearch(id, input) {
      calls.push(["saveSearch", id, input]);
      if (input.name === "너무많음") throw new Error("즐겨찾기는 20개까지 둘 수 있습니다.");
      const list = searches.get(id) ?? [];
      const { id: searchId, name, targetPrice, alertOn, ...query } = input;
      let search = list.find((each) => each.id === searchId);
      if (!search) {
        search = {
          id: nextId++,
          name,
          query,
          targetPrice: targetPrice || null,
          alertOn: alertOn !== false,
          conditions: query.filterKey ? ["세공 스매시 대미지 5레벨 이상"] : [],
          url: `https://mabi.spkuma.com/auction?keyword=${encodeURIComponent(query.keyword ?? "")}&ref=bot`,
        };
        list.push(search);
        searches.set(id, list);
        return { search, created: true };
      }
      Object.assign(search, {
        name: name ?? search.name,
        query,
        ...(typeof alertOn === "boolean" ? { alertOn } : {}),
      });
      return { search, created: false };
    },
    async removeSearch(id, searchId) {
      calls.push(["removeSearch", id, searchId]);
      searches.set(id, (searches.get(id) ?? []).filter((search) => search.id !== searchId));
      return searches.get(id);
    },
    async searchesStatus(id) {
      calls.push(["searchesStatus", id]);
      return {
        checkedAt: NOW,
        searches: (searches.get(id) ?? []).map((search) => ({
          ...search,
          unavailable: false,
          lowest: 4290,
          total: 1,
          icon: "https://icons.spkuma.com/f711.webp",
          checkedAt: NOW,
        })),
      };
    },
    async searchDetail(id, searchId) {
      const search = (searches.get(id) ?? []).find((each) => each.id === searchId);
      if (!search) throw new Error("저장한 검색을 찾지 못했습니다.");
      return { search, result: { ...searchResult(search.query), icon: "https://icons.spkuma.com/f711.webp" } };
    },
    async setSearchAlert(id, searchId, on) {
      calls.push(["setSearchAlert", id, searchId, on]);
      const search = (searches.get(id) ?? []).find((each) => each.id === searchId);
      if (!search) throw new Error("저장한 검색을 찾지 못했습니다.");
      search.alertOn = on;
      return search;
    },
    cards: {},
    async priceCard(name) {
      calls.push(["priceCard", name]);
      if (site.fail) throw site.fail;
      return site.cards[name] ?? null;
    },
    async dueArbeitAlerts(from, to) {
      calls.push(["dueArbeitAlerts", from, to]);
      return site.due;
    },
    async dueSearchAlerts(minuteIndex) {
      calls.push(["dueSearchAlerts", minuteIndex]);
      return site.searchDue;
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

/** 단추 누르기. 앞 화면의 카드(embeds)를 넘기면 검색 상태가 이어진다. */
export const click = (customId, values, user = ALICE, embeds) => ({
  ...base(3, user),
  ...(embeds ? { message: { embeds } } : {}),
  data: { custom_id: customId, ...(values ? { values } : {}) },
});

export const submit = (customId, fields, user = ALICE, embeds) => ({
  ...base(5, user),
  ...(embeds ? { message: { embeds } } : {}),
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
export const componentsOf = (view) => (view?.components ?? []).flatMap((line) => line.components ?? []);
/** 새 형식 메시지의 글 칸을 이어 붙인다. */
export const textOf = (view) =>
  (view?.components ?? [])
    .filter((each) => each.type === 10)
    .map((each) => each.content)
    .join("\n");
export const find = (view, customId) => componentsOf(view).find((component) => component.custom_id === customId);
export const ids = (view) => componentsOf(view).map((component) => component.custom_id ?? component.url);

/**
 * 상호작용을 처리하고 결과를 돌려준다. 처리 중으로 먼저 답한 화면은 원래 메시지를 고친 내용(edit)을 함께 준다.
 * 디스코드에 보내는 요청(fetch)은 가로채 기록한다.
 */
export async function run(site, interaction, { now = NOW } = {}) {
  const real = globalThis.fetch;
  const edits = [];
  globalThis.fetch = async (url, init) => {
    edits.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  };
  try {
    const initial = await handleInteraction(interaction, { SITE: site, DISCORD_APPLICATION_ID: "app" }, undefined, now);
    return { initial, view: initial.data, edit: edits.at(-1)?.body, edits };
  } finally {
    globalThis.fetch = real;
  }
}
