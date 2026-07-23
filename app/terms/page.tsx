export default function TermsPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <p className="section-title">Terms of Service</p>

      <div className="panel" style={{ marginBottom: 24, borderColor: '#8a7a3a' }}>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
          ⚠️ This is a working draft, not a final legal text. Before launching the
          app to real users, have this document reviewed by a lawyer.
        </p>
      </div>

      <h2>1. Who can use the app</h2>
      <p>
        The app may be used by people aged 13 and older (or the minimum age
        required by local law). By registering, you confirm that the information
        you provide is accurate.
      </p>

      <h2>2. Content you upload</h2>
      <p>
        You are responsible for the content you upload. By uploading, you grant
        the app permission to display it to other users in the ways the app
        offers (playback, sharing, recommendations). You remain the owner of
        your content.
      </p>

      <h2>3. What the app does not allow</h2>
      <p>
        See our <a href="/rules" style={{ color: 'var(--text)' }}>Community Guidelines</a> for
        the full list of prohibited content and behavior (including but not
        limited to: pornography, child exploitation material, real threats of
        violence, doxxing, non-consensual intimate content, and promotion of
        illegal activity).
      </p>

      <h2>4. Moderation and enforcement</h2>
      <p>
        The app reserves the right to remove content or restrict/suspend an
        account for violations of these Terms or the Community Guidelines,
        following the system described in the Guidelines.
      </p>

      <h2>5. Account termination</h2>
      <p>
        You can permanently delete your account at any time in Settings. The
        app also reserves the right to terminate accounts that repeatedly
        violate these rules.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        The app is provided "as is," with no guarantee of uninterrupted
        availability. We are not responsible for user-uploaded content that the
        app does not actively endorse.
      </p>

      <h2>7. Changes to these Terms</h2>
      <p>
        These Terms may change over time - we will notify you of significant
        changes.
      </p>

      <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 32 }}>
        Last updated: [add date]
      </p>
    </div>
  );
}
