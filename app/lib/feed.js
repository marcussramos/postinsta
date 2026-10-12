// Últimos posts publicados no Instagram do cliente, para a prévia da grade do feed.
import * as ig from './ig.js';

export async function recentFeed(c, limit = 12) {
  if (!c?.ig_token || !c?.ig_user_id) return [];
  const items = await ig.mediaBetween(c.ig_user_id, c.ig_token, 0, Date.now() + 864e5, 1);
  return items.slice(0, limit).map((m) => ({
    id: m.id, permalink: m.permalink, timestamp: m.timestamp,
    type: m.media_product_type === 'REELS' ? 'REELS' : m.media_type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : 'IMAGE',
    thumb: m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url,
  })).filter((m) => m.thumb);
}
