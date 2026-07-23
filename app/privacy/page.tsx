export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 720 }}>
      <p className="section-title">Privacy Policy</p>

      <div className="panel" style={{ marginBottom: 24, borderColor: '#8a7a3a' }}>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
          ⚠️ This is a working draft, not a final legal text. Before launching the
          app to real users, have this document reviewed by a lawyer specializing
          in GDPR - especially if you'll have users from the EU.
        </p>
      </div>

      <h2>What data the app collects</h2>
      <p>
        At registration: email, username, and password (the app never sees your
        password in readable form - that's handled by Supabase Auth).
      </p>
      <p>
        While using the app: videos and posts you upload, comments, ratings,
        subscriptions, watch history, and technical data such as your
        registration date.
      </p>

      <h2>What the app uses this data for</h2>
      <p>
        To run the app itself - logging in, displaying content, recommending
        videos, computing statistics, and general app functionality. The app
        does not sell your data or share it with advertising companies.
      </p>

      <h2>Who has access to the data</h2>
      <p>
        App data is stored with our providers, Supabase (database and
        authentication) and Cloudflare (video). Both are contractually bound to
        protect data under their own data processing terms.
      </p>

      <h2>Your rights (GDPR)</h2>
      <ul>
        <li><strong>Right of access</strong> - in Settings you can download a copy of all your data.</li>
        <li><strong>Right to erasure</strong> - in Settings you can permanently delete your account and all its data.</li>
        <li><strong>Right to rectification</strong> - you can update your profile information at any time.</li>
        <li><strong>Right to data portability</strong> - exported data is in a machine-readable format (JSON).</li>
      </ul>

      <h2>Cookies</h2>
      <p>
        The app only uses technical cookies/local storage necessary for login
        and remembering preferences (e.g. app theme). The app does not use
        tracking cookies for advertising.
      </p>

      <h2>Legal basis for processing</h2>
      <p>
        The app processes your data mainly because it's necessary to provide
        the service you requested (creating an account, uploading videos,
        displaying content). Some data (e.g. optional preferences) is
        processed based on your consent, which you can withdraw at any time by
        changing your settings or deleting your account.
      </p>

      <h2>Where your data is processed</h2>
      <p>
        The app runs on infrastructure provided by Supabase (database,
        authentication) and Cloudflare (video). Both are global companies,
        which may mean your data is processed outside the European Union. In
        that case, the transfer is covered by Standard Contractual Clauses
        (SCCs) or other safeguards required by GDPR - [fill in the specific
        region settings for Supabase/Cloudflare before launching the app
        publicly].
      </p>

      <h2>Right to lodge a complaint</h2>
      <p>
        If you believe the app has mishandled your data, you have the right to
        lodge a complaint with your national data protection authority (in the
        Czech Republic: the Office for Personal Data Protection, www.uoou.cz),
        or the equivalent authority in your country.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about your data can be directed to [add contact email].
      </p>

      <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 32 }}>
        Last updated: [add date]
      </p>
    </div>
  );
}
