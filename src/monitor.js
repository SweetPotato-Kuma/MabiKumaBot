import { EmbedBuilder } from "discord.js";

import { formatGold, formatPercent } from "./format.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class PriceMonitor {
  constructor({ mabinogiClient, itemStore, resolveChannel, intervalMs, threshold, cooldownMs, logger }) {
    this.mabinogiClient = mabinogiClient;
    this.itemStore = itemStore;
    this.resolveChannel = resolveChannel;
    this.intervalMs = intervalMs;
    this.threshold = threshold;
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

  clearCooldown(itemName) {
    this.lastAlertAtByItem.delete(itemName.toLocaleLowerCase("ko-KR"));
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
    const items = this.itemStore.getAll();
    if (items.length === 0) {
      this.logger.info("No monitoring items registered.");
      return;
    }

    if (!this.mabinogiClient.hasApiKey()) {
      this.logger.warn("Price check skipped: API_KEY or MABINOGI_API_KEY is not configured.");
      return;
    }

    this.logger.info(`Checking ${items.length} monitoring item(s).`);
    for (const itemName of items) {
      await this.checkItem(itemName);
      await sleep(250);
    }
  }

  async checkItem(itemName) {
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
        )}, discount=${formatPercent(marketData.discountRate)}`,
      );

      if (marketData.lowestPrice <= marketData.nextPrice * this.threshold) {
        await this.sendAlertIfAllowed(marketData);
      } else {
        this.clearCooldown(itemName);
      }

      return marketData;
    } catch (error) {
      this.logger.error(`${itemName}: price check failed:`, error);
      return null;
    }
  }

  async sendAlertIfAllowed(marketData) {
    const key = marketData.itemName.toLocaleLowerCase("ko-KR");
    const now = Date.now();
    const lastAlertAt = this.lastAlertAtByItem.get(key) ?? 0;

    if (this.cooldownMs > 0 && now - lastAlertAt < this.cooldownMs) {
      this.logger.info(`${marketData.itemName}: alert skipped by cooldown.`);
      return;
    }

    let channel = null;
    try {
      channel = await this.resolveChannel();
    } catch (error) {
      this.logger.warn(`Alert skipped: failed to resolve alert channel. ${error.message}`);
      return;
    }

    if (!channel) {
      this.logger.warn("Alert skipped: no alert channel configured. Use /구마 in Discord and press the alert-channel button.");
      return;
    }

    if (!channel?.isTextBased()) {
      this.logger.warn("Alert skipped: configured Discord alert channel is not text-based.");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`특가 알림: ${marketData.resolvedItemName}`)
      .setColor(0xe03131)
      .setDescription(`최저 등록가가 차순위 가격의 ${formatPercent(this.threshold)} 이하입니다.`)
      .addFields(
        { name: "최저 등록가", value: formatGold(marketData.lowestPrice), inline: true },
        { name: "차순위 가격", value: formatGold(marketData.nextPrice), inline: true },
        { name: "할인율", value: formatPercent(marketData.discountRate), inline: true },
      )
      .setFooter({ text: `Nexon Open API 경매장 키워드 검색 기준` })
      .setTimestamp(new Date());

    await channel.send({ content: `특가 후보를 찾았습니다: **${marketData.resolvedItemName}**`, embeds: [embed] });
    this.lastAlertAtByItem.set(key, now);
    this.logger.info(`${marketData.itemName}: alert sent.`);
  }
}
