export type Comparable = {
  store: string;
  title: string;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  price_ars: number | null;
};

export type Listing = Comparable & {
  external_ref: string;
  url: string;
  price_ars: number;
  seller: string | null;
  item_condition: string | null;
  observed_at: string;
};

export interface StoreAdapter {
  id: string;
  search(term: string): Promise<Listing[]>;
}

export class StoreFormatError extends Error {
  constructor(
    public store: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreFormatError";
  }
}
