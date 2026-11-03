import { selectOtpProvider } from '@/lib/auth/otp-providers';
import { LoginForm } from './LoginForm';

// Reads the OTP provider from the environment at request time, so the build does not need MSG91 keys.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const devHint = selectOtpProvider(process.env).name === 'dev';
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {devHint && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">Dev code: 123456</p>
      )}
      <LoginForm />
    </main>
  );
}
