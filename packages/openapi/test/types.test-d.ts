import { describe, expectTypeOf, it } from "vitest";

import { createOpenApiHandler, diffOpenApi, generateOpenApi } from "../src";

import type {
  OpenApiChange,
  OpenApiDiff,
  OpenApiDocument,
  OpenApiHandler,
  OpenApiOptions,
  OpenApiServeOptions,
} from "../src";
import type { AnyEndpoint, QuickbenConfig } from "@quickben/core";

declare const config: QuickbenConfig;

describe("openapi types", () => {
  it("generateOpenApi returns a document", () => {
    expectTypeOf(generateOpenApi(config)).toEqualTypeOf<OpenApiDocument>();
    expectTypeOf(generateOpenApi).parameter(1).toEqualTypeOf<OpenApiOptions | undefined>();
  });

  it("options are typed", () => {
    const options: OpenApiOptions = {
      info: { version: "1.0.0" },
      include: {
        collections: ["posts"],
        endpoints: (endpoint: AnyEndpoint) => endpoint.version === 1,
      },
      securitySchemes: { key: { type: "apiKey", in: "header", name: "x-key" } },
      security: [{ key: [] }],
    };
    expectTypeOf(options).toExtend<OpenApiOptions>();
    // @ts-expect-error -- `true` is not an include option for collections
    const bad: OpenApiOptions = { include: { collections: true } };
    expectTypeOf(bad).toBeObject();
  });

  it("the handler resolves a response or null", () => {
    const serve: OpenApiServeOptions = { serve: true, access: ({ user }) => user !== null };
    expectTypeOf(createOpenApiHandler(config, serve)).toEqualTypeOf<OpenApiHandler>();
    expectTypeOf<ReturnType<OpenApiHandler>>().toEqualTypeOf<Promise<Response | null>>();
  });

  it("diffOpenApi classifies changes", () => {
    const diff = diffOpenApi({}, {});
    expectTypeOf(diff).toEqualTypeOf<OpenApiDiff>();
    expectTypeOf<OpenApiChange["allowed"]>().toEqualTypeOf<"version" | "sunset" | undefined>();
  });
});
