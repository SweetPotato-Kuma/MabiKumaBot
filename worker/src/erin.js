/**
 * 에린 시각. 에린의 하루는 현실 36분이고 현실 1초가 에린 40초다.
 * 사이트(src/lib/erinTime.ts)와 같은 계산이며 보정값도 같아야 한다.
 */

export const ERIN_DAY_REAL_MS = 36 * 60 * 1000;

const ERIN_DAY_MS = 24 * 60 * 60 * 1000;
const SPEED = ERIN_DAY_MS / ERIN_DAY_REAL_MS;

/**
 * 게임 안 시계와 대조해 보정한 값(현실 ms).
 * 2026-10-19 한국 시각 09:54:21 에 00:10, 09:54:50 에 00:30 으로 바뀌는 것을 재서 맞췄다.
 */
export const ERIN_OFFSET_MS = 1_074_500;

export function erinClock(now) {
  const erinMs = ((((now + ERIN_OFFSET_MS) * SPEED) % ERIN_DAY_MS) + ERIN_DAY_MS) % ERIN_DAY_MS;
  const minutes = Math.floor(erinMs / 60_000);
  const hour = Math.floor(minutes / 60);
  return { hour, minute: minutes % 60, day: hour >= 6 && hour < 18 };
}

export function formatErinClock(clock) {
  return `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

/** 다음 에린 자정(NPC 상점이 바뀌는 때)까지 남은 현실 시간(ms). */
export function msUntilShopReset(now) {
  const into = (((now + ERIN_OFFSET_MS) % ERIN_DAY_REAL_MS) + ERIN_DAY_REAL_MS) % ERIN_DAY_REAL_MS;
  return ERIN_DAY_REAL_MS - into;
}

export function formatShopReset(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}분 ${rest}초 남음` : `${rest}초 남음`;
}
