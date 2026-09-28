import { Redis } from "ioredis";

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!redisInstance) {
    const url = process.env["REDIS_URL"] ?? "redis://localhost:6379";
    redisInstance = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    redisInstance.on("error", (err: Error) => {
      console.error("[redis] connection error", err);
    });
  }
  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
