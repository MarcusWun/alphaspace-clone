"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { apiClient } from "@/lib/api-client";

interface ArticleData {
  title: string;
  content: string;
  excerpt: string;
  author?: string;
  publishedAt?: string;
  siteName?: string;
  length: number;
}

interface ArticleOk {
  status: "ok";
  article: ArticleData;
}

interface ArticleFallback {
  status: "fallback";
  error: string;
}

type ArticlePayload = ArticleOk | ArticleFallback;

interface ArticleEnvelope {
  data: ArticlePayload;
}

async function fetchArticle(url: string): Promise<ArticlePayload> {
  const res = await apiClient.get<ArticleEnvelope>(
    `/api/article/extract?url=${encodeURIComponent(url)}`
  );
  return res.data;
}

interface ArticlePanelProps {
  panelId: string;
  url: string;
  title?: string;
}

export function ArticlePanel({ panelId, url, title }: ArticlePanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["article", url],
    queryFn: () => fetchArticle(url),
    enabled: !!url,
    staleTime: 24 * 60 * 60 * 1000,
  });

  if (!url) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-panel-id={panelId}>
        No article URL
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground" data-panel-id={panelId}>
        Loading article…
      </div>
    );
  }

  if (error || !data || data.status === "fallback") {
    return <FallbackCard url={url} title={title} panelId={panelId} />;
  }

  const a = data.article;
  return (
    <article
      className="p-4 h-full overflow-auto prose prose-sm max-w-none"
      data-panel-id={panelId}
    >
      <h1 className="text-lg font-semibold">{a.title}</h1>
      <div className="text-xs text-muted-foreground flex gap-2 pb-2 border-b">
        {a.siteName && <span>{a.siteName}</span>}
        {a.author && <span>· {a.author}</span>}
        {a.publishedAt && (
          <span>· {new Date(a.publishedAt).toLocaleDateString()}</span>
        )}
      </div>
      <div className="pt-3" dangerouslySetInnerHTML={{ __html: a.content }} />
    </article>
  );
}

function FallbackCard({
  url,
  title,
  panelId,
}: {
  url: string;
  title?: string;
  panelId?: string;
}) {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  return (
    <div
      className="p-4 h-full flex flex-col justify-center items-center gap-3 text-center text-sm"
      data-panel-id={panelId}
    >
      <p className="font-medium">{title ?? "Article unavailable"}</p>
      {host && <p className="text-xs text-muted-foreground">{host}</p>}
      <p className="text-xs text-muted-foreground max-w-xs">
        We couldn&apos;t extract the article content. Open the original to read it on
        the publisher&apos;s site.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Open original <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
