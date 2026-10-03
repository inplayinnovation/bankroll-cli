/** Cents as dollars, the way the sidebar shows money: $1,000.00. */
export const dollars = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
