import { useState } from 'react';
import { useCreateMembershipCheckout } from '@workspace/api-client-react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';

export default function MembershipCheckoutButton({ signedIn, label = 'Get Player Projections', primary = true }: { signedIn: boolean; label?: string; primary?: boolean }) {
  const checkout = useCreateMembershipCheckout();
  const [error, setError] = useState<string | null>(null);
  const startCheckout = async () => {
    if (!signedIn || checkout.isPending) return;
    setError(null);
    try {
      const result = await checkout.mutateAsync();
      const target = new URL(result.purchaseUrl, window.location.origin);
      if (target.protocol !== 'https:' && target.origin !== window.location.origin) throw new Error('The provider returned an invalid checkout link.');
      window.location.assign(target.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout could not be opened. Please try again.');
    }
  };
  return <div>
    <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-quiet'}`} onClick={startCheckout} disabled={!signedIn || checkout.isPending} aria-busy={checkout.isPending}>
      {checkout.isPending ? <LoaderCircle size={14} className="spin" /> : <ArrowUpRight size={14} />}
      {checkout.isPending ? 'Opening secure checkout…' : signedIn ? label : 'Sign in to join'}
    </button>
    {error && <p className="member-error" role="alert" style={{ margin: '8px 0 0', fontSize: 11 }}>{error}</p>}
  </div>;
}
