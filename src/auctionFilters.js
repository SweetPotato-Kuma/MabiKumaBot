function compactFilterText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s"'`.,/\\|()[\]{}<>:;!?~_\-+*=]+/g, "");
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeReforgeFilter(rawReforge) {
  if (!rawReforge || typeof rawReforge !== "object" || Array.isArray(rawReforge)) {
    return null;
  }

  const name = String(rawReforge.name ?? "").trim().replace(/\s+/g, " ");
  const min = normalizeOptionalNumber(rawReforge.min ?? rawReforge.gte);
  const max = normalizeOptionalNumber(rawReforge.max ?? rawReforge.lte);

  if (!name && min === null && max === null) {
    return null;
  }

  return { name, min, max };
}

export function normalizeAuctionOptionFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return {};
  }

  const normalized = {};
  const reforge = normalizeReforgeFilter(filters.reforge);
  if (reforge) {
    normalized.reforge = reforge;
  }

  return normalized;
}

export function hasAuctionOptionFilters(filters) {
  return Object.keys(normalizeAuctionOptionFilters(filters)).length > 0;
}

export function formatAuctionOptionFilters(filters) {
  const normalized = normalizeAuctionOptionFilters(filters);
  const parts = [];

  if (normalized.reforge) {
    const range = [];
    if (normalized.reforge.min !== null) {
      range.push(`${normalized.reforge.min} 이상`);
    }
    if (normalized.reforge.max !== null) {
      range.push(`${normalized.reforge.max} 이하`);
    }

    const name = normalized.reforge.name || "전체";
    parts.push(`세공: ${name}${range.length > 0 ? ` (${range.join(", ")})` : ""}`);
  }

  return parts.length > 0 ? parts.join(" / ") : "없음";
}

function optionText(option) {
  return [
    option?.option_type,
    option?.option_sub_type,
    option?.option_value,
    option?.option_value2,
    option?.option_desc,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(" ");
}

function optionNumericValue(option) {
  const matches = optionText(option).match(/-?\d+(?:\.\d+)?/g) ?? [];
  const numbers = matches.map(Number).filter(Number.isFinite);
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

function matchesReforgeFilter(option, reforge) {
  const text = optionText(option);
  const compactText = compactFilterText(text);
  const compactName = compactFilterText(reforge.name);
  const looksLikeReforge = compactText.includes(compactFilterText("세공"));

  if (!looksLikeReforge && !compactName) {
    return false;
  }

  if (compactName && !compactText.includes(compactName)) {
    return false;
  }

  if (reforge.min === null && reforge.max === null) {
    return true;
  }

  const value = optionNumericValue(option);
  if (value === null) {
    return false;
  }

  return (reforge.min === null || value >= reforge.min) && (reforge.max === null || value <= reforge.max);
}

export function matchesAuctionOptionFilters(auctionItem, filters) {
  const normalized = normalizeAuctionOptionFilters(filters);
  if (!hasAuctionOptionFilters(normalized)) {
    return true;
  }

  const options = Array.isArray(auctionItem?.itemOptions)
    ? auctionItem.itemOptions
    : Array.isArray(auctionItem?.item_option)
      ? auctionItem.item_option
      : [];

  if (normalized.reforge && !options.some((option) => matchesReforgeFilter(option, normalized.reforge))) {
    return false;
  }

  return true;
}
