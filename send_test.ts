// Copyright 2018-2020 the oak authors. All rights reserved. MIT license.

import { assert, assertEquals, assertStrictEquals, test } from "./test_deps.ts";

import type { Application } from "./application.ts";
import type { Context } from "./context.ts";
import { Status } from "./deps.ts";
import { httpErrors } from "./httpError.ts";
import { send } from "./send.ts";

let encodingsAccepted = "identity";

function createMockApp<
  // deno-lint-ignore no-explicit-any
  S extends Record<string | number | symbol, any> = Record<string, any>,
>(
  state = {} as S,
): Application<S> {
  return {
    state,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function createMockContext<
  // deno-lint-ignore no-explicit-any
  S extends Record<string | number | symbol, any> = Record<string, any>,
>(
  app: Application<S>,
  path = "/",
  method = "GET",
) {
  // deno-lint-ignore no-explicit-any
  let body: any;
  let status = Status.OK;
  const headers = new Headers();
  const resources: number[] = [];
  return ({
    app,
    request: {
      acceptsEncodings() {
        return encodingsAccepted;
      },
      headers: new Headers(),
      method,
      path,
      search: undefined,
      searchParams: new URLSearchParams(),
      url: new URL(`http://localhost${path}`),
    },
    response: {
      get status(): Status {
        return status;
      },
      set status(value: Status) {
        status = value;
      },
      // deno-lint-ignore no-explicit-any
      get body(): any {
        return body;
      },
      // deno-lint-ignore no-explicit-any
      set body(value: any) {
        body = value;
      },
      addResource(rid: number) {
        resources.push(rid);
      },
      destroy() {
        body = undefined;
        for (const rid of resources) {
          Deno.close(rid);
        }
      },
      headers,
      async toServerResponse() {
        return {
          status,
          body,
          headers,
        };
      },
    },
    state: app.state,
  } as unknown) as Context<S>;
}

// deno-lint-ignore no-explicit-any
function isDenoReader(value: any): value is Deno.Reader {
  return value && typeof value === "object" && "read" in value &&
    typeof value.read === "function";
}

function setup<
  // deno-lint-ignore no-explicit-any
  S extends Record<string | number | symbol, any> = Record<string, any>,
>(
  path = "/",
  method = "GET",
): {
  app: Application<S>;
  context: Context<S>;
} {
  encodingsAccepted = "identity";
  const app = createMockApp<S>();
  const context = createMockContext<S>(app, path, method);
  return { app, context };
}

test({
  name: "send HTML",
  async fn() {
    const { context } = setup("/test.html");
    const fixture = await Deno.readFile("./fixtures/test.html");
    await send(context, context.request.url.pathname, { root: "./fixtures" });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".html");
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    assert(context.response.headers.get("last-modified") != null);
    assertEquals(context.response.headers.get("cache-control"), "max-age=0");
    context.response.destroy();
  },
});

test({
  name: "send gzip",
  async fn() {
    const { context } = setup("/test.json");
    const fixture = await Deno.readFile("./fixtures/test.json.gz");
    encodingsAccepted = "gzip";
    await send(context, context.request.url.pathname, {
      root: "./fixtures",
    });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertEquals(context.response.headers.get("content-encoding"), "gzip");
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});

test({
  name: "send brotli",
  async fn() {
    const { context } = setup("/test.json");
    const fixture = await Deno.readFile("./fixtures/test.json.br");
    encodingsAccepted = "br";
    await send(context, context.request.url.pathname, { root: "./fixtures" });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertEquals(context.response.headers.get("content-encoding"), "br");
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});

test({
  name: "send identity",
  async fn() {
    const { context } = setup("/test.json");
    const fixture = await Deno.readFile("./fixtures/test.json");
    await send(context, context.request.url.pathname, {
      root: "./fixtures",
    });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertStrictEquals(context.response.headers.get("content-encoding"), null);
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});

test({
  name: "send 404",
  async fn() {
    const { context } = setup("/foo.txt");
    encodingsAccepted = "identity";
    let didThrow = false;
    try {
      await send(context, context.request.url.pathname, {
        root: "./fixtures",
      });
    } catch (e) {
      assert(e instanceof httpErrors.NotFound);
      didThrow = true;
    }
    assert(didThrow);
  },
});

test({
  name: "send file with spaces",
  async fn() {
    const { context } = setup("/test%20file.json");
    const fixture = await Deno.readFile("./fixtures/test file.json");
    await send(context, context.request.url.pathname, {
      root: "./fixtures",
    });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertStrictEquals(context.response.headers.get("content-encoding"), null);
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});

test({
  name: "send hidden file throws 403",
  async fn() {
    const { context } = setup("/.test.json");
    encodingsAccepted = "identity";
    let didThrow = false;
    try {
      await send(context, context.request.url.pathname, {
        root: "./fixtures",
      });
    } catch (e) {
      assert(e instanceof httpErrors.Forbidden);
      didThrow = true;
    }
    assert(didThrow);
  },
});

test({
  name: "send file from hidden dir throws 403",
  async fn() {
    const { context } = setup("/.test/test.json");
    encodingsAccepted = "identity";
    let didThrow = false;
    try {
      await send(context, context.request.url.pathname, {
        root: "./fixtures",
      });
    } catch (e) {
      assert(e instanceof httpErrors.Forbidden);
      didThrow = true;
    }
    assert(didThrow);
  },
});

test({
  name: "send hidden file succeeds when hidden:true",
  async fn() {
    const { context } = setup("/.test.json");
    const fixture = await Deno.readFile("./fixtures/.test.json");
    await send(context, context.request.url.pathname, {
      root: "./fixtures",
      hidden: true,
    });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertStrictEquals(context.response.headers.get("content-encoding"), null);
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});

test({
  name: "send file from hidden root succeeds",
  async fn() {
    const { context } = setup("/test.json");
    const fixture = await Deno.readFile("./fixtures/.test/test.json");
    await send(context, context.request.url.pathname, {
      root: "./fixtures/.test",
    });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertStrictEquals(context.response.headers.get("content-encoding"), null);
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});

test({
  name: "send url: /../file sends /file",
  async fn() {
    const { context } = setup("/../test.json");
    const fixture = await Deno.readFile("./fixtures/test.json");
    await send(context, context.request.url.pathname, {
      root: "./fixtures",
    });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertStrictEquals(context.response.headers.get("content-encoding"), null);
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});

test({
  name: "send path: /../file throws 403",
  async fn() {
    const { context } = setup("/../test.json");
    encodingsAccepted = "identity";
    let didThrow = false;
    try {
      await send(context, "/../test.json", {
        root: "./fixtures",
      });
    } catch (e) {
      assert(e instanceof httpErrors.Forbidden);
      didThrow = true;
    }
    assert(didThrow);
  },
});

test({
  name: "send allows .. in root",
  async fn() {
    const { context } = setup("/test.json");
    const fixture = await Deno.readFile("./fixtures/test.json");
    await send(context, context.request.url.pathname, {
      root: "../oak/fixtures",
    });
    const serverResponse = context.response.toServerResponse();
    const bodyReader = (await serverResponse).body;
    assert(isDenoReader(bodyReader));
    const body = await Deno.readAll(bodyReader);
    assertEquals(body, fixture);
    assertEquals(context.response.type, ".json");
    assertStrictEquals(context.response.headers.get("content-encoding"), null);
    assertEquals(
      context.response.headers.get("content-length"),
      String(fixture.length),
    );
    context.response.destroy();
  },
});
