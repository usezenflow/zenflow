import { INestApplication, type ExecutionContext } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { CookieAuthGuard } from "../src/auth/guards";
import { PrismaService } from "../src/prisma/prisma.service";
import { paletteBodyParser } from "../src/users/palette-body";
import { PALETTE_MAX_BYTES } from "../src/users/palette.service";
import { UsersModule } from "../src/users/users.module";

/** `/users/me/palette` over HTTP: the raw body parser, ETag, If-Match and the 204, 412 and 413 answers. */

interface Row {
  paletteData: Buffer | null;
  paletteUpdatedAt: Date | null;
}
const rows = new Map<string, Row>();
const rowOf = (id: string): Row => {
  if (!rows.has(id))
    rows.set(id, { paletteData: null, paletteUpdatedAt: null });
  return rows.get(id)!;
};

const prismaStub = {
  user: {
    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve({ ...rowOf(where.id) }),
    updateMany: ({
      where,
      data,
    }: {
      where: { id: string; paletteUpdatedAt: Date | null };
      data: Row;
    }) => {
      const row = rowOf(where.id);
      const want = where.paletteUpdatedAt?.getTime() ?? null;
      const have = row.paletteUpdatedAt?.getTime() ?? null;
      if (want !== have) return Promise.resolve({ count: 0 });
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    },
  },
};

describe("Palette (e2e)", () => {
  let app: INestApplication<App>;
  const bin = (u: string, buf: Buffer, ifMatch?: string, user = "u1") => {
    const r = request(app.getHttpServer())
      .put(u)
      .set("x-test-user", user)
      .set("Content-Type", "application/octet-stream");
    if (ifMatch !== undefined) r.set("If-Match", ifMatch);
    return r.send(buf);
  };
  const URL = "/users/me/palette";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        UsersModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideGuard(CookieAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<{ user: unknown; headers: Record<string, string> }>();
          req.user = { id: req.headers["x-test-user"] ?? "u1" };
          return true;
        },
      })
      .compile();
    app = moduleFixture.createNestApplication({ bodyParser: true });
    app.use(URL, paletteBodyParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => rows.clear());

  it("answers 204 when empty", async () => {
    const res = await request(app.getHttpServer()).get(URL);
    expect(res.status).toBe(204);
  });

  it("round trips bytes with an ETag", async () => {
    const bytes = Buffer.from([1, 0, 255, 7]);
    const put = await bin(URL, bytes, "0");
    expect(put.status).toBe(200);
    const etag = String(put.headers.etag);
    const got = await request(app.getHttpServer())
      .get(URL)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toContain("application/octet-stream");
    expect(String(got.headers.etag)).toBe(etag);
    expect([...(got.body as Buffer)]).toEqual([...bytes]);
  });

  it("accepts the next put with the returned tag and rejects the old one with 412", async () => {
    const first = await bin(URL, Buffer.from([1]), "0");
    const tag = String(first.headers.etag);
    await new Promise((r) => setTimeout(r, 5));
    const second = await bin(URL, Buffer.from([2]), tag);
    expect(second.status).toBe(200);
    const stale = await bin(URL, Buffer.from([3]), tag);
    expect(stale.status).toBe(412);
  });

  it("answers 412 when the first put claims an existing tag", async () => {
    expect((await bin(URL, Buffer.from([1]), "12345")).status).toBe(412);
  });

  it("answers 412 without If-Match", async () => {
    expect((await bin(URL, Buffer.from([1]))).status).toBe(412);
  });

  it("answers 400 for a malformed If-Match", async () => {
    expect((await bin(URL, Buffer.from([1]), "abc")).status).toBe(400);
    expect((await bin(URL, Buffer.from([1]), "-5")).status).toBe(400);
    expect((await bin(URL, Buffer.from([1]), "1.5")).status).toBe(400);
  });

  it("accepts a quoted If-Match", async () => {
    expect((await bin(URL, Buffer.from([1]), '"0"')).status).toBe(200);
  });

  it("answers 400 for an empty body", async () => {
    expect((await bin(URL, Buffer.alloc(0), "0")).status).toBe(400);
  });

  it("accepts exactly the limit and answers 413 one byte over", async () => {
    expect(
      (await bin(URL, Buffer.alloc(PALETTE_MAX_BYTES, 1), "0")).status,
    ).toBe(200);
    rows.clear();
    expect(
      (await bin(URL, Buffer.alloc(PALETTE_MAX_BYTES + 1, 1), "0")).status,
    ).toBe(413);
    expect(rowOf("u1").paletteData).toBeNull();
  });

  it("keeps each user's palette apart", async () => {
    await bin(URL, Buffer.from([9]), "0", "u1");
    const other = await request(app.getHttpServer())
      .get(URL)
      .set("x-test-user", "u2");
    expect(other.status).toBe(204);
  });

  it("does not store a body sent as another content type", async () => {
    const res = await request(app.getHttpServer())
      .put(URL)
      .set("If-Match", "0")
      .set("Content-Type", "application/json")
      .send({ a: 1 });
    expect(res.status).toBe(400);
    expect(rowOf("u1").paletteData).toBeNull();
  });
});
