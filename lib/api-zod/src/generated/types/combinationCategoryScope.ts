/** Category-specific eligibility evidence for a bounded pricing batch. */
export interface CombinationCategoryScope {
  categoryId: string;
  categoryName: string;
  eligibleMembers: number;
  ruleCount: number;
  skipped: boolean;
}
