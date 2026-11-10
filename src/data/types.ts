export type Comparable = {
  tienda: string;
  titulo: string;
  marca: string | null;
  modelo: string | null;
  gtin: string | null;
  precio_ars: number | null;
};

export type Listing = Comparable & {
  ref_externa: string;
  url: string;
  precio_ars: number;
  vendedor: string | null;
  condicion: string | null;
  observado_en: string;
};

export interface StoreAdapter {
  id: string;
  search(term: string): Promise<Listing[]>;
}

export class StoreFormatError extends Error {
  constructor(
    public tienda: string,
    message: string,
  ) {
    super(message);
    this.name = "StoreFormatError";
  }
}
