-- The website is a static Astro build served as Worker assets; the Worker no longer stores rendered pages.
-- Apply by hand only after the Astro Worker is live (pnpm db:migrate:remote).
DROP TABLE IF EXISTS pages;
