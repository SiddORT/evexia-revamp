import type { KitsWrite } from "./kitsWrite";
export interface KitsUpdate extends KitsWrite {
  expected_version: number;
}
