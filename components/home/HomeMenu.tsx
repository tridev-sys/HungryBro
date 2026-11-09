import Link from 'next/link';

/** The home screen. Signed-out and signed-in variants differ only in the greeting and the account links. */
export function HomeMenu({ signedIn, name }: { signedIn: boolean; name: string | null }) {
  return (
    <main className="min-h-screen bg-bg px-4 py-10 text-text">
      <h1 className="text-3xl font-semibold">{signedIn ? `Hi, ${name ?? 'there'}` : 'Autonomous Food OS'}</h1>
      <nav aria-label="Home" className="mt-8 flex flex-col gap-3">
        <Link href="/order" className="flex min-h-11 items-center rounded-card bg-accent px-5 py-4 font-semibold text-accent-ink">
          Order delivery
        </Link>
        <Link href="/dine" className="flex min-h-11 items-center rounded-card bg-surface px-5 py-4 font-medium">
          Dine in
        </Link>
        {signedIn ? (
          <>
            <Link href="/profile/settings" className="flex min-h-11 items-center rounded-card bg-surface px-5 py-4 font-medium">
              My account
            </Link>
            <form action="/auth/logout" method="post">
              <button type="submit" className="flex min-h-11 w-full items-center rounded-card bg-surface-2 px-5 py-4 font-medium">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/auth/login" className="flex min-h-11 items-center rounded-card bg-surface px-5 py-4 font-medium">
            Sign in
          </Link>
        )}
      </nav>
    </main>
  );
}
