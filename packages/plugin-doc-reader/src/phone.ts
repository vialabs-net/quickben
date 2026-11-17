/**
 * Telephone numbers in E.164 (`+<country code><national number>`) for a field's default
 * country. Only countries with a plan here are supported; a number that does not fit its
 * country's plan is not guessed.
 */

/** A country's numbering plan: calling code, national number lengths and trunk prefix. */
interface PhonePlan {
  readonly code: string;
  readonly national: readonly number[];
  /** Dialled before a national number inside the country, e.g. `0`. */
  readonly trunk?: string;
}

/** Plans by ISO 3166-1 alpha-2 code. */
export const PHONE_PLANS = {
  AR: { code: "54", national: [10], trunk: "0" },
  BR: { code: "55", national: [10, 11], trunk: "0" },
  CA: { code: "1", national: [10], trunk: "1" },
  CL: { code: "56", national: [9], trunk: "0" },
  CO: { code: "57", national: [10] },
  ES: { code: "34", national: [9] },
  MX: { code: "52", national: [10] },
  PE: { code: "51", national: [9], trunk: "0" },
  US: { code: "1", national: [10], trunk: "1" },
  UY: { code: "598", national: [8], trunk: "0" },
} as const satisfies Record<string, PhonePlan>;

export type PhoneCountry = keyof typeof PHONE_PLANS;
export const PHONE_COUNTRIES = Object.keys(PHONE_PLANS) as [PhoneCountry, ...PhoneCountry[]];

/**
 * The E.164 form of a number printed in `country`, or `null` when it does not fit the plan.
 * Accepts `+56 9 1234 5678`, `0056…`, `56912345678`, `912345678`, `(2) 2123 4567` and a
 * trunk prefix (`09…`).
 */
export function toE164(raw: string, country: PhoneCountry): string | null {
  const plan: PhonePlan = PHONE_PLANS[country];
  const text = raw.trim();
  let digits = text.replaceAll(/\D/gu, "");
  const international = text.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);
  const withCode =
    digits.startsWith(plan.code) && plan.national.includes(digits.length - plan.code.length);
  if (withCode) return `+${digits}`;
  if (international) return null;
  if (plan.trunk && digits.startsWith(plan.trunk)) {
    const rest = digits.slice(plan.trunk.length);
    if (plan.national.includes(rest.length)) return `+${plan.code}${rest}`;
  }
  return plan.national.includes(digits.length) ? `+${plan.code}${digits}` : null;
}

/** The national number of an E.164 value of `country`, or `null`. */
export function nationalNumber(e164: string, country: PhoneCountry): string | null {
  const code = `+${PHONE_PLANS[country].code}`;
  return e164.startsWith(code) ? e164.slice(code.length) : null;
}
