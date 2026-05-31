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
      JSON.stringify(item.item_option ?? []),
    ].join("|");

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

function mapAuctionItem(auctionItem) {
  return {
    itemName: String(auctionItem.item_name ?? ""),
    displayName: String(auctionItem.item_display_name ?? ""),
    category: String(auctionItem.auction_item_category ?? ""),
    count: Number(auctionItem.item_count ?? 0),
    expireAt: auctionItem.date_auction_expire ?? null,
    pricePerUnit: asPositiveNumber(auctionItem.auction_price_per_unit),
  };
}

function uniqueSearchTerms(values) {
  const seen = new Set();
  const result = [];

  for (const value of values ?? []) {
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
    const key = compactSearchText(normalized);
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function canonicalItemName(auctionItem, targetName) {
  const targetKey = compactSearchText(targetName);
  const itemName = String(auctionItem.itemName ?? "").trim();
  const displayName = String(auctionItem.displayName ?? itemName).trim();

  if (itemName && (!targetKey || compactSearchText(itemName).includes(targetKey))) {
    return itemName;
  }

  return displayName || itemName;
}

function buildSearchTerms(inputName, resolvedItemName, auctionItem = null) {
  const targetKey = compactSearchText(inputName);
  const relatedNames = [inputName, resolvedItemName];

  if (auctionItem?.itemName && compactSearchText(auctionItem.itemName).includes(targetKey)) {
    relatedNames.push(auctionItem.itemName);
  }

  if (auctionItem?.displayName) {
    relatedNames.push(auctionItem.displayName);
  }

  return uniqueSearchTerms(relatedNames);
}

function normalizeMarketCriteria(criteria) {
  const itemName = typeof criteria === "string" ? criteria : criteria?.itemName;
  const normalizedItemName = String(itemName ?? "").trim().replace(/\s+/g, " ");
  const category = typeof criteria === "string" ? "" : String(criteria?.category ?? "").trim();
  const searchTerms =
    typeof criteria === "string"
      ? uniqueSearchTerms([normalizedItemName])
      : uniqueSearchTerms([...(Array.isArray(criteria?.searchTerms) ? criteria.searchTerms : []), normalizedItemName]);

  return {
    itemName: normalizedItemName,
    category,
    searchTerms,
  };
}

function itemMatchRank(auctionItem, targetName) {
  const targetKey = compactSearchText(targetName);
  const itemName = compactSearchText(auctionItem.itemName);
  const displayName = compactSearchText(auctionItem.displayName);

  if (!targetKey) {
    return 99;
  }
  if (itemName === targetKey) {
    return 0;
  }
  if (displayName === targetKey) {
    return 1;
  }
  if (itemName.includes(targetKey)) {
    return 2;
  }
  if (displayName.includes(targetKey)) {
    return 3;
  }
  if (itemName && targetKey.includes(itemName)) {
    return 4;
  }

  return 99;
}

function sortAuctionItemMatches(itemName) {
  return (left, right) => {
    const leftRank = itemMatchRank(left, itemName);
    const rightRank = itemMatchRank(right, itemName);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftPrice = left.pricePerUnit ?? Number.MAX_SAFE_INTEGER;
    const rightPrice = right.pricePerUnit ?? Number.MAX_SAFE_INTEGER;
    return leftPrice - rightPrice;
  };
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
      const itemCheck = await this.findAuctionItem(itemName);
      return itemCheck.resolvedItemName || itemName;
    } catch {
      return itemName;
    }
  }

  async fetchAuctionPage(keyword, cursor = "", { timeoutMs = this.timeoutMs } = {}) {
    const url = new URL(this.endpoint);
    url.searchParams.set("keyword", keyword);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
    return {
      items: Array.isArray(data.auction_item) ? data.auction_item : [],
      nextCursor: typeof data.next_cursor === "string" && data.next_cursor ? data.next_cursor : null,
    };
  }

  async fetchAuctionItems(keyword, { maxPages = 1, timeoutMs = this.timeoutMs } = {}) {
    const items = [];
    let cursor = "";

    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.fetchAuctionPage(keyword, cursor, { timeoutMs });
      items.push(...result.items);

      if (!result.nextCursor) {
        break;
      }

      cursor = result.nextCursor;
    }

    return items;
  }

  async suggestAuctionItems(keyword, { limit = 25, timeoutMs = 1800 } = {}) {
    if (!this.hasApiKey()) {
      return [];
    }

    const normalizedKeyword = compactSearchText(keyword);
    if (!normalizedKeyword) {
      return [];
    }

    const candidates = buildKeywordCandidates(keyword).slice(0, 3);
    const pages = await Promise.allSettled(
      candidates.map((candidate) => this.fetchAuctionItems(candidate, { maxPages: 1, timeoutMs })),
    );
    const auctionItems = pages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
    const seen = new Set();

    return dedupeAuctionItems(auctionItems)
      .map(mapAuctionItem)
      .filter(
        (auctionItem) =>
          auctionItem.displayName &&
          (compactSearchText(auctionItem.displayName).includes(normalizedKeyword) ||
            compactSearchText(auctionItem.itemName).includes(normalizedKeyword)),
      )
      .sort(sortAuctionItemMatches(keyword))
      .map((auctionItem) => {
        const itemName = canonicalItemName(auctionItem, keyword);
        return {
          itemName,
          category: auctionItem.category,
          searchTerms: buildSearchTerms(keyword, itemName, auctionItem),
          pricePerUnit: auctionItem.pricePerUnit,
        };
      })
      .filter((candidate) => {
        const key = compactSearchText(candidate.itemName);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  async findAuctionItem(itemName, { maxPages = 2 } = {}) {
    if (!this.hasApiKey()) {
      throw new MabinogiApiError("API_KEY 또는 MABINOGI_API_KEY가 설정되지 않았습니다.");
    }

    const normalizedTarget = compactSearchText(itemName);
    const searchedKeywords = [];
    const allAuctionItems = [];
    let matchingItems = [];

    for (const keyword of buildKeywordCandidates(itemName)) {
      searchedKeywords.push(keyword);
      const auctionItems = await this.fetchAuctionItems(keyword, { maxPages });
      allAuctionItems.push(...auctionItems);

      matchingItems = dedupeAuctionItems(allAuctionItems)
        .map(mapAuctionItem)
        .filter(
          (auctionItem) =>
            compactSearchText(auctionItem.displayName).includes(normalizedTarget) ||
            compactSearchText(auctionItem.itemName).includes(normalizedTarget),
        )
        .sort(sortAuctionItemMatches(itemName));

      if (matchingItems.length > 0) {
        break;
      }
    }

    const firstItem = matchingItems[0] ?? null;
    const resolvedItemName = firstItem ? canonicalItemName(firstItem, itemName) : itemName;

    return {
      found: matchingItems.length > 0,
      itemName,
      resolvedItemName,
      category: firstItem?.category ?? "",
      searchTerms: buildSearchTerms(itemName, resolvedItemName, firstItem),
      searchKeywords: searchedKeywords,
      rawCount: dedupeAuctionItems(allAuctionItems).length,
      matchingCount: matchingItems.length,
      firstItem,
    };
  }

  async fetchMarketData(criteria) {
    if (!this.hasApiKey()) {
      throw new MabinogiApiError("API_KEY 또는 MABINOGI_API_KEY가 설정되지 않았습니다.");
    }

    const marketCriteria = normalizeMarketCriteria(criteria);
    const normalizedTargets = marketCriteria.searchTerms.map(compactSearchText).filter(Boolean);
    const cacheKey = normalizedTargets.join("|") || compactSearchText(marketCriteria.itemName);
    const cachedKeyword = this.resolvedKeywordCache.get(cacheKey);
    const searchKeywords = uniqueSearchTerms([
      cachedKeyword,
      ...marketCriteria.searchTerms,
      ...buildKeywordCandidates(marketCriteria.itemName),
    ]).slice(0, 6);
    const searchedKeywords = [];
    const allAuctionItems = [];
    let matchingItems = [];
    const maxPages = marketCriteria.searchTerms.length > 1 ? 2 : 1;

    for (const keyword of searchKeywords) {
      searchedKeywords.push(keyword);
      const auctionItems = await this.fetchAuctionItems(keyword, { maxPages });
      allAuctionItems.push(...auctionItems);

      matchingItems = dedupeAuctionItems(allAuctionItems)
        .map(mapAuctionItem)
        .filter(
          (auctionItem) =>
            auctionItem.pricePerUnit !== null &&
            normalizedTargets.some(
              (target) =>
                compactSearchText(auctionItem.displayName).includes(target) ||
                compactSearchText(auctionItem.itemName).includes(target),
            ),
        )
        .sort((a, b) => a.pricePerUnit - b.pricePerUnit);

      if (matchingItems.length >= 2) {
        break;
      }
    }

    if (matchingItems.length < 2) {
      return {
        found: false,
        itemName: marketCriteria.itemName,
        resolvedItemName: matchingItems[0] ? canonicalItemName(matchingItems[0], marketCriteria.itemName) : marketCriteria.itemName,
        category: marketCriteria.category,
        searchTerms: marketCriteria.searchTerms,
        searchKeywords: searchedKeywords,
        rawCount: dedupeAuctionItems(allAuctionItems).length,
        matchingCount: matchingItems.length,
      };
    }

    const [lowestItem, nextItem] = matchingItems;
    const resolvedItemName = lowestItem.displayName || marketCriteria.itemName;
    const discountRate = 1 - lowestItem.pricePerUnit / nextItem.pricePerUnit;
    this.resolvedKeywordCache.set(cacheKey, resolvedItemName);

    return {
      found: true,
      itemName: marketCriteria.itemName,
      resolvedItemName,
      category: marketCriteria.category,
      searchTerms: marketCriteria.searchTerms,
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
