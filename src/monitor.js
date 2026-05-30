import { EmbedBuilder } from "discord.js";

import { formatGold, formatPercent } from "./format.js";
import { normalizeItemKey } from "./itemStore.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toAlertDiscountPercent(value) {
  const percent = Number(value);
  return Number.isInteger(percent) && percent >= 10 && percent <= 100 ? percent : 10;
}

export class PriceMonitor {
  constructor({
    mabinogiClient,
    itemStore,
    settingsStore,
    resolveChannel,
    intervalMs,
    defaultAlertDiscountPercent,
    cooldownMs,
    logger,
  }) {
    this.mabinogiClient = mabinogiClient;
    this.itemStore = itemStore;
    this.settingsStore = settingsStore;
    this.resolveChannel = resolveChannel;
    this.intervalMs = intervalMs;
    this.defaultAlertDiscountPercent = toAlertDiscountPercent(defaultAlertDiscountPercent);
    this.cooldownMs = cooldownMs;
    this.logger = logger;
    this.running = false;
    this.timer = null;
    this.checking = false;
    this.lastRunAt = null;
    this.nextRunAt = null;
    this.lastError = null;
    this.lastAlertAtByItem = new Map();
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.logger.info(`Price monitor started. interval=${Math.round(this.intervalMs / 1000)}s`);
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextRunAt = null;
    this.logger.info("Price monitor stopped.");
  }

  getStatus() {
    return {
      running: this.running,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      lastError: this.lastError,
    };
  }

  clearCooldown(userId, itemName) {
    if (itemName === undefined) {
      itemName = userId;
      userId = "global";
    }

    this.lastAlertAtByItem.delete(this.buildCooldownKey(userId, itemName));
  }

  setIntervalMs(intervalMs) {
    this.intervalMs = intervalMs;
    this.logger.info(`Price monitor interval updated. interval=${Math.round(this.intervalMs / 1000)}s`);

    if (this.running && !this.checking) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.schedule(this.intervalMs);
    }
  }

  schedule(delayMs) {
    if (!this.running) {
      return;
    }

    this.nextRunAt = new Date(Date.now() + delayMs);
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  async tick() {
    if (!this.running) {
      return;
    }

    if (this.checking) {
      this.logger.warn("Previous price check is still running. Skipping this tick.");
      this.schedule(this.intervalMs);
      return;
    }

    this.checking = true;
    try {
      await this.checkAll();
      this.lastError = null;
    } catch (error) {
      this.lastError = error.message;
      this.logger.error("Price monitor tick failed:", error);
    } finally {
      this.checking = false;
      this.lastRunAt = new Date();
      this.schedule(this.intervalMs);
    }
  }

  async checkAll() {
    const users = this.itemStore.getUsers();
    const itemCount = users.reduce((total, userData) => total + userData.items.length, 0);

    if (itemCount === 0) {
      this.logger.info("No monitoring items registered.");
      return;
    }

    if (!this.mabinogiClient.hasApiKey()) {
      this.logger.warn("Price check skipped: API_KEY or MABINOGI_API_KEY is not configured.");
      return;
    }

    this.logger.info(`Checking ${itemCount} monitoring item(s) for ${users.length} user(s).`);
    for (const userData of users) {
      for (const itemName of userData.items) {
        await this.checkItem(userData.userId, itemName);
        await sleep(250);
      }
    }
  }

  async checkItem(userId, itemName) {
    const alertDiscountPercent = this.settingsStore.getAlertDiscountPercent(userId, this.defaultAlertDiscountPercent);
    const alertDiscountRate = alertDiscountPercent / 100;

    try {
      const marketData = await this.mabinogiClient.fetchMarketData(itemName);
      if (!marketData.found) {
        this.logger.warn(
          `${itemName}: insufficient auction data. raw=${marketData.rawCount}, matching=${marketData.matchingCount}`,
        );
        return null;
      }

      this.logger.info(
        `${itemName} -> ${marketData.resolvedItemName}: lowest=${marketData.lowestPrice.toLocaleString("ko-KR")}, next=${marketData.nextPrice.toLocaleString(
          "ko-KR",
        )}, discount=${formatPercent(marketData.discountRate)}, user=${userId}, threshold=${alertDiscountPercent}%`,
      );

      if (marketData.discountRate >= alertDiscountRate) {
        await this.sendAlertIfAllowed(userId, marketData, alertDiscountPercent);
      } else {
        this.clearCooldown(userId, itemName);
      }

      return marketData;
    } catch (error) {
      this.logger.error(`${itemName}: price check failed:`, error);
      return null;
    }
  }

  async sendAlertIfAllowed(userId, marketData, alertDiscountPercent) {
    const key = this.buildCooldownKey(userId, marketData.itemName);
    const now = Date.now();
    const lastAlertAt = this.lastAlertAtByItem.get(key) ?? 0;

    if (this.cooldownMs > 0 && now - lastAlertAt < this.cooldownMs) {
      this.logger.info(`${marketData.itemName}: alert skipped by cooldown. user=${userId}`);
      return;
    }

    let channel = null;
    try {
      channel = await this.resolveChannel(userId);
    } catch (error) {
      this.logger.warn(`Alert skipped: failed to resolve alert channel. user=${userId}. ${error.message}`);
      return;
    }

    if (!channel) {
      this.logger.warn(`Alert skipped: no alert channel configured for user=${userId}. Use /구마 and press the alert-channel button.`);
      return;
    }

    if (!channel?.isTextBased()) {
      this.logger.warn(`Alert skipped: configured Discord alert channel is not text-based. user=${userId}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`가격 알림: ${marketData.resolvedItemName}`)
      .setColor(0xe03131)
      .setDescription(`기준가 대비 ${alertDiscountPercent}% 이상 낮은 매물을 찾았습니다.`)
      .addFields(
        { name: "최저 등록가", value: formatGold(marketData.lowestPrice), inline: true },
        { name: "기준가(차순위)", value: formatGold(marketData.nextPrice), inline: true },
        { name: "할인율", value: formatPercent(marketData.discountRate), inline: true },
        { name: "내 알림 기준", value: `${alertDiscountPercent}% 이상 낮을 때`, inline: false },
      )
      .setFooter({ text: "Nexon Open API 경매장 데이터 기준" })
      .setTimestamp(new Date());

    await channel.send({ content: `<@${userId}> 구마가 매물을 찾았습니다: **${marketData.resolvedItemName}**`, embeds: [embed] });
    this.lastAlertAtByItem.set(key, now);
    this.logger.info(`${marketData.itemName}: alert sent. user=${userId}`);
  }

  buildCooldownKey(userId, itemName) {
    return `${userId ?? "global"}:${normalizeItemKey(itemName)}`;
  }
}
