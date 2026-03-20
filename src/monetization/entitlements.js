import { isMonetizationLimitsEnabled } from "../config/feature-flags.js";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function getEntitlementState(settings, env = process.env) {
  const monetization =
    settings?.monetization && typeof settings.monetization === "object"
      ? settings.monetization
      : {};
  const onboarding =
    settings?.onboarding && typeof settings.onboarding === "object"
      ? settings.onboarding
      : {};
  const limitEnabled = isMonetizationLimitsEnabled(env);
  const plan = String(monetization.plan || "free");
  const dailyViewLimit = Number.isFinite(Number(monetization.dailyViewLimit))
    ? Math.max(0, Math.round(Number(monetization.dailyViewLimit)))
    : 10;
  const dailyViewCount = Number.isFinite(Number(monetization.dailyViewCount))
    ? Math.max(0, Math.round(Number(monetization.dailyViewCount)))
    : 0;
  const dailyViewDate = String(monetization.dailyViewDate || "").trim();
  const isToday = dailyViewDate === todayIsoDate();
  const viewsUsedToday = isToday ? dailyViewCount : 0;
  const monthlySearchLimit = Number.isFinite(Number(monetization.monthlySearchLimit))
    ? Math.max(0, Math.round(Number(monetization.monthlySearchLimit)))
    : 10;
  const monthlySearchCount = Number.isFinite(Number(monetization.monthlySearchCount))
    ? Math.max(0, Math.round(Number(monetization.monthlySearchCount)))
    : 0;
  const monthlySearchMonth = String(monetization.monthlySearchMonth || "").trim();
  const searchesUsedThisMonth = monthlySearchMonth === currentMonthKey() ? monthlySearchCount : 0;
  const jobsInDbLimit = Number.isFinite(Number(monetization.jobsInDbLimit))
    ? Math.max(0, Math.round(Number(monetization.jobsInDbLimit)))
    : 500;
  const enforced = limitEnabled && plan === "free";
  const remaining = enforced ? Math.max(0, dailyViewLimit - viewsUsedToday) : null;
  const searchesRemainingThisMonth = enforced
    ? Math.max(0, monthlySearchLimit - searchesUsedThisMonth)
    : null;

  return {
    plan,
    dailyViewLimit,
    viewsUsedToday,
    remaining,
    monthlySearchLimit,
    searchesUsedThisMonth,
    searchesRemainingThisMonth,
    jobsInDbLimit,
    limitEnabled: enforced,
    onboardingCompleted: Boolean(onboarding.completed)
  };
}
