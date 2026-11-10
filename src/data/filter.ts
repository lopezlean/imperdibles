import {
  parseCandidateList,
  type Candidate,
  type CandidateList,
  type StoreOffer,
} from "../contract/candidate-list.js";

type MlOffer = Candidate["ml"];
type OtherOffer = Candidate["otras"][number];

export type MatchedGroup = {
  modelo_id: string;
  marca: string;
  titulo: string;
  imagen_url: string | null;
  ml: MlOffer;
  otras: { offer: OtherOffer; regla: "gtin" | "marca_codigo_variante" }[];
};

/** True when ML is at least `umbralPct` percent cheaper than the other price. Unrounded, integer arithmetic. */
export function passesThreshold(mlPrice: number, otherPrice: number, umbralPct: number): boolean {
  if (otherPrice <= 0) return false;
  return (otherPrice - mlPrice) * 100 >= umbralPct * otherPrice;
}

function byPriceThenStore(a: StoreOffer, b: StoreOffer): number {
  return a.precio_ars - b.precio_ars || (a.tienda < b.tienda ? -1 : a.tienda > b.tienda ? 1 : 0);
}

/** Replaces ml and otras (rivals sorted ascending) and recomputes the differences from the cheapest rival. */
export function applyPrices(candidate: Candidate, ml: MlOffer, otras: OtherOffer[]): Candidate {
  const sorted = [...otras].sort(byPriceThenStore);
  const cheapest = sorted[0];
  if (!cheapest) throw new Error("applyPrices requires at least one rival");
  const diferencia_ars = cheapest.precio_ars - ml.precio_ars;
  return {
    ...candidate,
    ml,
    otras: sorted,
    diferencia_ars,
    diferencia_pct: (diferencia_ars * 100) / cheapest.precio_ars,
  };
}

export function buildCandidateList(input: {
  corrida_id: string;
  fecha: string;
  categoria: string;
  umbral_pct: number;
  groups: MatchedGroup[];
}): CandidateList {
  const withRivals = input.groups.filter((g) => g.otras.length > 0);
  const candidatos: Candidate[] = [];
  for (const g of withRivals) {
    const ranked = [...g.otras].sort((a, b) => byPriceThenStore(a.offer, b.offer));
    const cheapest = ranked[0]!;
    if (!passesThreshold(g.ml.precio_ars, cheapest.offer.precio_ars, input.umbral_pct)) continue;
    const seed: Candidate = {
      candidato_id: `${input.corrida_id}:${g.modelo_id}`,
      modelo_id: g.modelo_id,
      marca: g.marca,
      titulo: g.titulo,
      imagen_url: g.imagen_url,
      ml: g.ml,
      otras: [],
      diferencia_ars: 0,
      diferencia_pct: 0,
      confianza: "alta",
      regla_emparejado: cheapest.regla,
    };
    candidatos.push(
      applyPrices(seed, g.ml, ranked.map((r) => r.offer)),
    );
  }
  candidatos.sort(
    (a, b) =>
      b.diferencia_pct - a.diferencia_pct || (a.modelo_id < b.modelo_id ? -1 : a.modelo_id > b.modelo_id ? 1 : 0),
  );
  return parseCandidateList({
    version: 1,
    corrida_id: input.corrida_id,
    fecha: input.fecha,
    categoria: input.categoria,
    umbral_pct: input.umbral_pct,
    modelos_comparados: withRivals.length,
    candidatos,
  });
}
