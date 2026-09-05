import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Snakes Hosting</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/api/auth/discord">
            <button>Login with Discord</button>
          </Link>
          <Link href="/dashboard">
            <button className="secondary">Dashboard</button>
          </Link>
        </div>
      </header>

      <section style={{ marginTop: 64 }}>
        <h1 style={{ fontSize: 40 }}>Host your game backend, managed by Discord.</h1>
        <p style={{ color: 'var(--muted)', fontSize: 18, marginTop: 12 }}>
          Create an account with the Discord bot, then spin up and manage your backend
          instances from the dashboard. Free and paid plans available.
        </p>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 48 }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <h3>Free</h3>
          <ul style={{ color: 'var(--muted)', lineHeight: 1.9, marginTop: 8 }}>
            <li>1 hosting instance</li>
            <li>7 hours of backend runtime</li>
          </ul>
        </div>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
          <h3>Paid</h3>
          <ul style={{ color: 'var(--muted)', lineHeight: 1.9, marginTop: 8 }}>
            <li>5 hosting instances</li>
            <li>Unlimited backend runtime</li>
          </ul>
        </div>
      </section>

      <section style={{ marginTop: 48, color: 'var(--muted)' }}>
        <h2 style={{ color: 'var(--text)', fontSize: 24 }}>How it works</h2>
        <ol style={{ lineHeight: 2 }}>
          <li>Join the Discord server and talk to the bot to create your account.</li>
          <li>Log in here with Discord (OAuth).</li>
          <li>Create an instance, then Start it.</li>
          <li>Your backend runs on our host. Free tier is capped at 7 hours total runtime.</li>
        </ol>
      </section>
    </main>
  );
}