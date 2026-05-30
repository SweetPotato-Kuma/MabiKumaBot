export class MabinogiApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "MabinogiApiError";
    this.status = status;
    this.body = body;
  }
}

function asPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function compactSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s"'`.,/\\|()[\]{}<>:;!?~_\-+*=]+/g, "");
}

function pushUnique(values, value) {
  const normalized = String(value ?? "").trim();
  if (normalized && !values.includes(normalized)) {
    values.push(normalized);
  }
}

const COMMON_ITEM_TAIL_WORDS = [
  "허브",
  "포션",
  "엘릭서",
  "가죽",
  "옷감",
  "실크",
  "실",
  "장작",
  "광석",
  "주괴",
  "괴",
  "염료",
  "보석",
  "결정",
  "가루",
  "구슬",
  "날개",
  "스크롤",
];

function buildKeywordCandidates(itemName) {
  const raw = String(itemName ?? "").trim().replace(/\s+/g, " ");
  const compact = raw.replace(/\s+/g, "");
  const candidates = [];

  pushUnique(candidates, raw);

  if (compact && compact !== raw) {
    pushUnique(candidates, compact);
  }

  for (const tailWord of COMMON_ITEM_TAIL_WORDS) {
    if (compact.endsWith(tailWord) && compact.length > tailWord.length) {
      pushUnique(candidates, `${compact.slice(0, -tailWord.length)} ${tailWord}`);
    }
  }

  if (!raw.includes(" ") && compact.length >= 4) {
    pushUnique(candidates, compact.slice(0, 2));
    pushUnique(candidates, compact.slice(0, 3));
    pushUnique(candidates, compact.slice(-2));
    pushUnique(candidates, compact.slice(-3));
  }

  return candidates;
}

function dedupeAuctionItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = [
      item.item_display_name,
      item.item_count,
      item.auction_item_category,
      item.auction_price_per_unit,
      item.date_auction_expire,
    ].join("|");

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

export class MabinogiClient {
  constructor({ apiKey, endpoint, timeoutMs }) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.resolvedKeywordCache = new Map();
  }

  hasApiKey() {
    return Boolean(this.apiKey);
  }

  async resolveItemName(itemName) {
    if (!this.hasApiKey()) {
      return itemName;
    }

    try {
      const marketData = await this.fetchMarketData(itemName);
      return marketData.resolvedItemName || itemName;
    } catch {
      return itemName;
    }
  }

  async fetchAuctionItems(keyword) {
    const url = new URL(this.endpoint);
    url.searchParams.set("keyword", keyword);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-nxopen-api-key": this.apiKey,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new MabinogiApiError(`Nexon API 요청 시간이 초과되었습니다. keyword=${keyword}`);
      }
      throw new MabinogiApiError(`Nexon API 요청에 실패했습니다. keyword=${keyword}: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new MabinogiApiError(`Nexon API 응답 오류: ${response.status}`, {
        status: response.status,
        body,
      });
    }

    const data = await response.json();
    return Array.isArray(data.auction_item) ? data.auction_item : [];
  }

  async fetchMarketData(itemName) {
    if (!this.hasApiKey()) {
      throw new MabinogiApiError("API_KEY 또는 MABINOGI_API_KEY가 설정되지 않았습니다.");
    }

    const normalizedTarget = compactSearchText(itemName);
    const cachedKeyword = this.resolvedKeywordCache.get(normalizedTarget);
    const searchKeywords = [...new Set(cachedKeyword ? [cachedKeyword, ...buildKeywordCandidates(itemName)] : buildKeywordCandidates(itemName))];
    const searchedKeywords = [];
    const allAuctionItems = [];
    let matchingItems = [];

    for (const keyword of searchKeywords) {
      searchedKeywords.push(keyword);
      const auctionItems = await this.fetchAuctionItems(keyword);
      allAuctionItems.push(...auctionItems);

      matchingItems = dedupeAuctionItems(allAuctionItems)
        .map((auctionItem) => ({
          itemName: String(auctionItem.item_name ?? ""),
          displayName: String(auctionItem.item_display_name ?? ""),
          category: String(auctionItem.auction_item_category ?? ""),
          count: Number(auctionItem.item_count ?? 0),
          expireAt: auctionItem.date_auction_expire ?? null,
          pricePerUnit: asPositiveNumber(auctionItem.auction_price_per_unit),
        }))
        .filter((auctionItem) => compactSearchText(auctionItem.displayName).includes(normalizedTarget) && auctionItem.pricePerUnit !== null)
        .sort((a, b) => a.pricePerUnit - b.pricePerUnit);

      if (matchingItems.length >= 2) {
        break;
      }
    }

    if (matchingItems.length < 2) {
      return {
        found: false,
        itemName,
        resolvedItemName: matchingItems[0]?.displayName ?? itemName,
        searchKeywords: searchedKeywords,
        rawCount: dedupeAuctionItems(allAuctionItems).length,
        matchingCount: matchingItems.length,
      };
    }

    const [lowestItem, nextItem] = matchingItems;
    const resolvedItemName = lowestItem.displayName || itemName;
    const discountRate = 1 - lowestItem.pricePerUnit / nextItem.pricePerUnit;
    this.resolvedKeywordCache.set(normalizedTarget, resolvedItemName);

    return {
      found: true,
      itemName,
      resolvedItemName,
      searchKeywords: searchedKeywords,
      rawCount: dedupeAuctionItems(allAuctionItems).length,
      matchingCount: matchingItems.length,
      lowestPrice: lowestItem.pricePerUnit,
      nextPrice: nextItem.pricePerUnit,
      discountRate,
      lowestItem,
      nextItem,
    };
  }
}
