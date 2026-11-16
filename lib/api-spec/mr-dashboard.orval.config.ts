// Offline, additive dashboard generation. Never runs checks or touches the
// older generated contracts whose refinements belong to other workflows.
import { defineConfig } from "orval";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, "openapi.yaml"), "utf8"));
const route = "/v1/mr/sales-achievement/dashboard";
const schemas: Record<string, unknown> = {};
function collect(value: unknown) {
  if (Array.isArray(value)) return value.forEach(collect);
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.$ref === "string" && record.$ref.startsWith("#/components/schemas/")) {
    const name = record.$ref.split("/").pop()!;
    if (!(name in schemas)) {
      schemas[name] = contract.components.schemas[name];
      collect(schemas[name]);
    }
  }
  Object.values(record).forEach(collect);
}
collect(contract.paths[route]);
const input = {
  target: {
    openapi: contract.openapi,
    info: { ...contract.info, title: "MRDashboardApi" },
    paths: { [route]: contract.paths[route] },
    components: { schemas, securitySchemes: contract.components.securitySchemes },
  },
};
export default defineConfig({
  dashboardClient: {
    input,
    output: {
      target: path.join(root, "lib/api-client-react/src/mr-dashboard-generated/dashboard.ts"),
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: false,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: path.join(root, "lib/api-client-react/src/custom-fetch.ts"), name: "customFetch" },
      },
    },
  },
  dashboardZod: {
    input,
    output: {
      target: path.join(root, "lib/api-zod/src/mr-dashboard-generated/dashboard.ts"),
      client: "zod",
      mode: "split",
      clean: true,
      prettier: false,
      override: { zod: { version: 3 } },
    },
  },
});
