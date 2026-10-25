import { randomUUID } from "crypto";

interface TokenRow {
  id: string;
  kind: "CODE" | "ACCESS" | "REFRESH";
  hash: string;
  familyId: string;
  scope: string;
  codeChallenge: string | null;
  redirectUri: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  clientId: string;
  userId: string;
}

/** Just enough of Prisma's OAuth tables for the provider and consent specs. */
export function fakeOAuthPrisma() {
  const clients = new Map<
    string,
    { id: string; name: string | null; metadata: unknown }
  >();
  let tokens: TokenRow[] = [];
  const matches = (row: TokenRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, want]) => {
      const have = (row as unknown as Record<string, unknown>)[key];
      if (want === null) return have === null;
      if (want && typeof want === "object" && "gt" in want)
        return (have as Date) > (want as { gt: Date }).gt;
      return have === want;
    });

  const prisma = {
    oAuthClient: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(clients.get(where.id) ?? null),
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          [...clients.values()].filter((c) => where.id.in.includes(c.id)),
        ),
      create: ({
        data,
      }: {
        data: { id: string; name: string | null; metadata: unknown };
      }) => {
        clients.set(data.id, data);
        return Promise.resolve(data);
      },
    },
    oAuthToken: {
      create: ({ data }: { data: Partial<TokenRow> }) => {
        const row = {
          id: randomUUID(),
          usedAt: null,
          createdAt: new Date(),
          codeChallenge: null,
          redirectUri: null,
          scope: "",
          ...data,
        } as TokenRow;
        tokens.push(row);
        return Promise.resolve(row);
      },
      createMany: ({ data }: { data: Partial<TokenRow>[] }) => {
        for (const d of data) {
          tokens.push({
            id: randomUUID(),
            usedAt: null,
            createdAt: new Date(),
            codeChallenge: null,
            redirectUri: null,
            scope: "",
            ...d,
          } as TokenRow);
        }
        return Promise.resolve({ count: data.length });
      },
      findFirst: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(tokens.find((t) => matches(t, where)) ?? null),
      findUnique: ({ where }: { where: { hash: string } }) =>
        Promise.resolve(tokens.find((t) => t.hash === where.hash) ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<TokenRow>;
      }) => {
        const hit = tokens.filter((t) => matches(t, where));
        hit.forEach((t) => Object.assign(t, data));
        return Promise.resolve({ count: hit.length });
      },
      deleteMany: ({ where }: { where: Record<string, unknown> }) => {
        const before = tokens.length;
        tokens = tokens.filter((t) => !matches(t, where));
        return Promise.resolve({ count: before - tokens.length });
      },
      groupBy: ({ where }: { where: Record<string, unknown> }) => {
        const byClient = new Map<string, Date>();
        for (const t of tokens.filter((x) => matches(x, where))) {
          const seen = byClient.get(t.clientId);
          if (!seen || t.createdAt < seen)
            byClient.set(t.clientId, t.createdAt);
        }
        return Promise.resolve(
          [...byClient].map(([clientId, createdAt]) => ({
            clientId,
            _min: { createdAt },
          })),
        );
      },
    },
  };
  return { prisma, tokens: () => tokens, clients };
}
