/** Coordinated source contract; generator/build/checks intentionally not run. */
export interface KitsPricingInput {
  kitRate?: string | null;
  lancetsRate?: string | null;
  applicatorsRate?: string | null;
  trayRate?: string | null;
  forwardingCharges: string;
  discountType: "percent" | "inr";
  discountValue: string;
}
