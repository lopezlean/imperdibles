export type ChannelPost = { id: number; text: string; date: Date };

export interface ChannelReader {
  /** afterId set: posts with id > afterId. afterId null: posts dated at or after `since`. Ascending by id, text-only. */
  fetchPosts(opts: { afterId: number | null; since: Date }): Promise<ChannelPost[]>;
}
