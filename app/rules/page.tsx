export default function RulesPage() {
  return (
    <div style={{ maxWidth: 720, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.7 }}>
      <h1 style={{ color: 'var(--text)' }}>Kine Community Guidelines</h1>
      <p>
        Kine is a platform built on free speech. We want everyone to be able to say what
        they think - including opinions we disagree with, controversial topics, hard
        satire, and dark humor. The vast majority of that kind of content (an estimated
        80%) isn't meant as an attack on anyone in particular - it's exaggeration, a joke,
        or a personal opinion.
      </p>
      <p>
        <strong style={{ color: 'var(--text)' }}>If you don't like an opinion, downvote it
        (or rate it low with stars) and move on.</strong> Removal and bans aren't a tool
        for making opinions you disagree with disappear.
      </p>

      <h2 style={{ color: 'var(--text)' }}>What's fine here (even if it offends someone)</h2>
      <ul>
        <li>Controversial political, religious, and social opinions</li>
        <li>Satire, parody, and dark humor</li>
        <li>Criticism of public figures, companies, institutions</li>
        <li>Open discussion of sensitive topics</li>
      </ul>

      <h2 style={{ color: 'var(--text)' }}>What's forbidden - standard violations</h2>
      <p>These result in a permanent ban on uploading new content (the account stays active as a viewer, just without upload access):</p>
      <ul>
        <li>Pornography and explicit sexual content</li>
        <li>Spam, fraudulent, or deceptive content</li>
        <li>Repeated harassment of a specific person</li>
        <li>Copyright infringement (see the section below)</li>
      </ul>

      <h2 style={{ color: 'var(--text)' }}>What's forbidden - serious violations (immediate, full account ban)</h2>
      <p>
        These result in an immediate and complete ban of the entire account (not just an
        upload ban), and in some cases a report to the relevant authorities:
      </p>
      <ul>
        <li>Content that abuses or sexualizes children - zero tolerance, mandatory reporting to authorities</li>
        <li>Real threats of violence against a specific person</li>
        <li>Documenting or promoting illegal activity</li>
        <li>Doxxing - publishing someone else's personal information (address, phone number) with intent to harm</li>
        <li>Non-consensual intimate content ("revenge porn")</li>
      </ul>

      <h2 style={{ color: 'var(--text)' }}>Copyright</h2>
      <p>
        Don't upload content you don't have the rights to. If you believe your content was
        used without permission, contact us (we're gradually building a formal reporting
        process).
      </p>

      <h2 style={{ color: 'var(--text)' }}>Suitability for children</h2>
      <p>
        When uploading, you indicate whether a video is suitable for children. Please take
        this seriously - it's about protecting the platform's most vulnerable users.
      </p>

      <p style={{ marginTop: 32, color: 'var(--text-faint)', fontSize: 12 }}>
        These guidelines will keep expanding over time (e.g. with a formal content-reporting
        system). By using Kine, you agree to them.
      </p>
    </div>
  );
}
