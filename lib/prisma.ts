/**
 * Prisma client (Rust-free) bound to PostgreSQL through the `pg` driver
 * adapter. The query compiler runs as WASM inside the Node process; no
 * native engine binary is needed.
 *
 * The client is constructed lazily on first use so that module imports stay
 * side-effect free (Next.js imports route modules during `next build` before
 * any environment is guaranteed).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Start the stack with `npm run dev` or export " +
        "DATABASE_URL=postgresql://postgres@127.0.0.1:5432/anatomy",
    );
  }
  const adapter = new PrismaPg({ connectionString, max: 10 });
  return new PrismaClient({ adapter });
}

function getInstance(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Lazy Prisma proxy - behaves exactly like a PrismaClient but only connects
 * (and validates DATABASE_URL) on first actual use.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const instance = getInstance() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === "function" ? value.bind(instance) : value ?? Reflect.get(instance, prop, receiver);
  },
});

export default prisma;
