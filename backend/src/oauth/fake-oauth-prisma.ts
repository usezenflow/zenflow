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
    { id: string; name: string | null; metadata: unknown; createdAt?: Date }
  >();
  let tokens: TokenRow[] = [];
  const matches = (row: TokenRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, want]) => {
      const have = (row as unknown as Record<string, unknown>)[key];
      if (want === null) return have === null;
      if (want && typeof want === "object" && "gt" in want)
        return (have as Date) > (want as { gt: Date }).gt;
      if (want && typeof want === "object" && "in" in want)
        return (want as { in: unknown[] }).in.includes(have);
      return have === want;
    });

  const consents = new Map<
    string,
    {
      id: string;
      clientId: string;
      userId: string | null;
      expiresAt: Date;
      usedAt: Date | null;
    }
  >();

  const prisma = {
    oAuthConsent: {
      create: ({ data }: { data: { clientId: string; expiresAt: Date } }) => {
        const row = { id: randomUUID(), userId: null, usedAt: null, ...data };
        consents.set(row.id, row);
        return Promise.resolve({ id: row.id });
      },
      updateMany: ({
        where,
        data,
      }: {
        where: {
          id: string;
          usedAt: null;
          expiresAt: { gt: Date };
          OR: { userId: string | null }[];
        };
        data: { userId: string; usedAt?: Date };
      }) => {
        const row = consents.get(where.id);
        const open =
          row &&
          row.usedAt === null &&
          row.expiresAt > where.expiresAt.gt &&
          where.OR.some((c) =>
            c.userId === null ? row.userId === null : c.userId === row.userId,
          );
        if (!open) return Promise.resolve({ count: 0 });
        Object.assign(row, data);
        return Promise.resolve({ count: 1 });
      },
    },
    oAuthClient: {
      count: ({ where }: { where: { createdAt: { gt: Date } } }) =>
        Promise.resolve(
          [...clients.values()].filter(
            (c) => (c.createdAt ?? new Date(0)) > where.createdAt.gt,
          ).length,
        ),
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
        const row = { ...data, createdAt: new Date() };
        clients.set(data.id, row);
        return Promise.resolve(row);
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
  return { prisma, tokens: () => tokens, clients, consents };
}
