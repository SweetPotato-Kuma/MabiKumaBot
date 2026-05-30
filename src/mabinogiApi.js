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

export class MabinogiClient {
  constructor({ apiKey, endpoint, timeoutMs }) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
  }

  hasApiKey() {
    return Boolean(this.apiKey);
  }

  async fetchMarketData(itemName) {
    if (!this.hasApiKey()) {
      throw new MabinogiApiError("API_KEY 또는 MABINOGI_API_KEY가 설정되지 않았습니다.");
    }

    const url = new URL(this.endpoint);
    url.searchParams.set("keyword", itemName);

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
        throw new MabinogiApiError(`Nexon API 요청 시간이 초과되었습니다. item=${itemName}`);
      }
      throw new MabinogiApiError(`Nexon API 요청에 실패했습니다. item=${itemName}: ${error.message}`);
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
    const auctionItems = Array.isArray(data.auction_item) ? data.auction_item : [];
    const matchingItems = auctionItems
      .map((auctionItem) => ({
        displayName: String(auctionItem.item_display_name ?? ""),
        pricePerUnit: asPositiveNumber(auctionItem.auction_price_per_unit),
      }))
      .filter((auctionItem) => auctionItem.displayName.includes(itemName) && auctionItem.pricePerUnit !== null)
      .sort((a, b) => a.pricePerUnit - b.pricePerUnit);

    if (matchingItems.length < 2) {
      return {
        found: false,
        itemName,
        rawCount: auctionItems.length,
        matchingCount: matchingItems.length,
      };
    }

    const [lowestItem, nextItem] = matchingItems;
    const discountRate = 1 - lowestItem.pricePerUnit / nextItem.pricePerUnit;

    return {
      found: true,
      itemName,
      rawCount: auctionItems.length,
      matchingCount: matchingItems.length,
      lowestPrice: lowestItem.pricePerUnit,
      nextPrice: nextItem.pricePerUnit,
      discountRate,
      lowestItem,
      nextItem,
    };
  }
}
