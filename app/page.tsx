// Customer landing page. A server component with no client APIs, so it renders fully without JavaScript.
// Colours, radii and surfaces come only from the tokens in app/theme.css.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-between gap-10 px-6 py-12">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-semibold text-[var(--color-text)]">Autonomous Food OS</h1>
        <p className="text-base text-[var(--color-text-muted)]">
          Order food for delivery or dine in at a table.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <a
            href="/delivery"
            className="flex min-h-11 w-full items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-4 py-3 text-base font-semibold text-[var(--color-accent-ink)]"
          >
            Order delivery
          </a>
          <a
            href="/dine"
            className="flex min-h-11 w-full items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-4 py-3 text-base font-semibold text-[var(--color-accent-ink)]"
          >
            Dine in
          </a>
        </div>
      </section>

      <nav className="flex flex-col gap-3">
        <a
          href="/auth/login"
          className="flex min-h-11 w-full items-center justify-center rounded-[var(--radius-pill)] border border-[var(--color-surface-2)] bg-[var(--color-surface)] px-4 py-3 text-base text-[var(--color-text)]"
        >
          Sign in
        </a>
      </nav>

      <footer className="text-center text-sm text-[var(--color-text-muted)]">Autonomous Food OS</footer>
    </main>
  );
}
