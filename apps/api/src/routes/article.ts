import { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { extractArticle, ShortContentError } from "../services/article/extract.js";
import { getRedis } from "../services/redis.js";

const ARTICLE_CACHE_TTL = 86_400; // 24 hours

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export const articleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { url: string } }>(
    "/article/extract",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["url"],
          properties: {
            url: {
              type: "string",
              minLength: 10,
              pattern: "^https?://",
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { url } = request.query;
      const redis = getRedis();
      const cacheKey = `article:extract:${sha256(url)}`;
      const t0 = Date.now();

      // Cache hit
      const cached = await redis.get(cacheKey);
      if (cached) {
        request.log.info({ event: "article.cache_hit", url });
        return reply.send({ data: JSON.parse(cached) });
      }
      request.log.info({ event: "article.cache_miss", url });

      request.log.info({ event: "article.extract.start", url });

      try {
        const article = await extractArticle(url);
        const ms = Date.now() - t0;
        request.log.info({ event: "article.extract.ok", url, length: article.length, ms });

        const payload = { status: "ok", article };
        await redis.set(cacheKey, JSON.stringify(payload), "EX", ARTICLE_CACHE_TTL);
        return reply.send({ data: payload });
      } catch (err) {
        const ms = Date.now() - t0;

        if (err instanceof ShortContentError) {
          request.log.info({ event: "article.extract.fallback", url, reason: "short_content", ms });
          const payload = { status: "fallback", error: "short_content" };
          await redis.set(cacheKey, JSON.stringify(payload), "EX", ARTICLE_CACHE_TTL);
          return reply.send({ data: payload });
        }

        const message = err instanceof Error ? err.message : String(err);
        const reason = message.startsWith("fetch_failed") ? "fetch_failed" : "parse_failed";
        request.log.info({ event: "article.extract.fallback", url, reason, ms });
        const payload = { status: "fallback", error: reason };
        await redis.set(cacheKey, JSON.stringify(payload), "EX", ARTICLE_CACHE_TTL);
        return reply.send({ data: payload });
      }
    }
  );
};
