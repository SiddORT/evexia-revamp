import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  // These endpoints accept both bounded raw bytes and multipart. Orval cannot
  // serialize a union of Blob and a multipart object (it passes the object as
  // BodyInit). Generated callers use the supported multipart variant; the
  // portal's memory-only transport uses raw bytes. Authoritative OpenAPI retains
  // both representations.
  for (const route of ["/v1/admin/courier-partners/import/review", "/v1/admin/courier-partners/import/commit"]) {
    const request = config.paths?.[route]?.post?.requestBody;
    if (request && !("$ref" in request) && request.content?.["multipart/form-data"]) {
      delete request.content["application/octet-stream"];
    }
  }
  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      mode: "split",
      clean: true,
      // Keep the package barrel hand-curated: Orval also emits operation
      // parameter types whose names can collide with Zod path-parameter schemas.
      indexFiles: false,
      prettier: true,
      override: {
        zod: {
          // Orval resolves `auto` from lib/api-spec/package.json, which has no
          // zod dependency, so orval >= 8.23 falls back to Zod 4 syntax while
          // the catalog installs zod 3. Pin to match the catalog.
          version: 3,
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
