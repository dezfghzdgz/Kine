/**
 * Načítání po našem: místo obecného kolečka značka Kine (trojúhelník přehrát) v barvě
 * appky, která „dýchá“, a kolem ní tenký oblouk, co obíhá. Jedna věc pro video, živé
 * vysílání i Sparks - vzhled se řídí barvou appky (--brand), takže sedí ke každému motivu.
 * Jen CSS (app/globals.css .kine-loader), žádný obrázek ke stažení.
 *
 *   <KineLoader />                 56 px, hned
 *   <KineLoader size="sm" delayed /> 40 px, ukáže se až po 350 ms (Sparks: při okamžitém
 *                                   rozjezdu nic neblikne)
 */
export default function KineLoader({ size = 'md', delayed = false, label, className }: { size?: 'sm' | 'md' | 'lg'; delayed?: boolean; label?: string; className?: string }) {
  return (
    <span
      className={`kine-loader kine-loader-${size}${delayed ? ' kine-loader-delayed' : ''}${className ? ` ${className}` : ''}`}
      role="status"
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="kine-loader-ring" aria-hidden="true" />
      <svg className="kine-loader-mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.3 5.6c0-.9 1-1.5 1.8-1l9.2 6.4c.7.5.7 1.5 0 2l-9.2 6.4c-.8.5-1.8-.1-1.8-1z" fill="currentColor" />
      </svg>
    </span>
  );
}
