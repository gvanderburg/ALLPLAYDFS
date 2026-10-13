/** Compact injury labels; the complete source status stays available on hover. */
export function InjuryBadge({ status }: { status?: string | null }) {
  const value = status?.trim() ?? '';
  let label = '';
  let severity = '';
  if (/\bout\b|\binactive\b|\bir\b|injured[- ]reserve|reserve\/injured|^o$/i.test(value)) {
    label = /\bir\b|injured[- ]reserve|reserve\/injured/i.test(value) ? 'IR' : /\binactive\b/i.test(value) ? 'INACTIVE' : 'OUT';
    severity = 'out';
  } else if (/\bquestionable\b|^q$/i.test(value)) {
    label = 'QUESTIONABLE';
    severity = 'questionable';
  } else if (/\bdoubtful\b/i.test(value)) {
    label = 'DOUBTFUL';
    severity = 'doubtful';
  } else if (/day[- ]to[- ]day|\bdtd\b/i.test(value)) {
    label = 'DTD';
    severity = 'questionable';
  }
  if (!label) return null;
  return <span className={`injury-badge injury-${severity}`} title={value} aria-label={`Injury status: ${value}`}>{label}</span>;
}
