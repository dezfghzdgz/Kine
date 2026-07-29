export default function SupporterBadge({ isSupporter }: { isSupporter?: boolean | null }) {
  if (!isSupporter) return null;

  return (
    <span
      title="Podpořil/a appku Kine"
      style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 5, fontSize: 13 }}
    >
      💛
    </span>
  );
}
