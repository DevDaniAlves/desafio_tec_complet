import type { Db } from '../db.js';
import type { Article } from '../domain/types.js';

const STOP = new Set(['de', 'da', 'do', 'a', 'o', 'e', 'em', 'no', 'na', 'que', 'um', 'uma', 'meu', 'minha', 'com', 'para', 'por', 'não', 'nao', 'está', 'esta']);

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export const tokens = (s: string) =>
  norm(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

/** Busca lexical simples sobre título (peso 3), tags (peso 2) e corpo (peso 1). Suficiente para ~10 artigos. */
export class KbService {
  private articles: Promise<Article[]> | null = null;

  constructor(private readonly db: Db) {}

  private load(): Promise<Article[]> {
    this.articles ??= this.db.all<Article>('SELECT id, title, body, tags FROM articles');
    return this.articles;
  }

  async search(query: string, limit = 3): Promise<{ article: Article; score: number }[]> {
    const q = tokens(query);
    if (!q.length) return [];
    return (await this.load())
      .map((article) => {
        const title = norm(article.title);
        const tags = norm(article.tags.join(' '));
        const body = norm(article.body);
        let score = 0;
        for (const t of q) {
          if (title.includes(t)) score += 3;
          if (tags.includes(t)) score += 2;
          if (body.includes(t)) score += 1;
        }
        return { article, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
