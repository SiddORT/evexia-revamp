import type { KitsPricingInput } from "./kitsPricingInput";
export interface KitsPricingSnapshot extends KitsPricingInput {
  taxPercentage: string;
  lineAmounts: Record<string, string>;
  gross: string;
  discountAmount: string;
  discounted: string;
  taxable: string;
  gst: string;
  total: string;
}
