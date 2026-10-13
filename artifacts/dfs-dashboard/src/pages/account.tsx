import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useAuth, useClerk } from '@clerk/react';
import { getGetMembershipStatusQueryKey, useCancelMembership } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, Check, CircleAlert, Clock3, Copy, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import useMembership from '@/hooks/use-membership';
import MembershipCheckoutButton from '@/components/membership-checkout-button';

function formatPeriod(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function secureManageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function messageForStatus(status: string) {
  const value = status.toLowerCase().replaceAll('_', ' ');
  return value === 'none' || value === 'free' || value === 'inactive' ? 'No active membership is attached to this account.' : `Provider status: ${value}.`;
}

export default function Account() {
  const { isSignedIn, userId } = useAuth();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const membershipQuery = useMembership(isSignedIn === true);
  const cancel = useCancelMembership();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [copyStatus, setCopyStatus] = useState('');
  const params = new URLSearchParams(window.location.search);
  const checkoutReturned = params.get('checkout') === 'returned';
  const status = membershipQuery.data;
  const unavailable = membershipQuery.isError || (!!status && (!status.ready || !!status.error || status.status.toLowerCase() === 'unavailable' || status.signedIn !== true));
  const entitled = status?.hasAccess === true && !unavailable;
  const owner = entitled && status?.isOwner === true;
  const manageUrl = secureManageUrl(status?.manageUrl);

  useEffect(() => {
    if (!checkoutReturned || entitled || pollCount >= 10) return;
    const timer = window.setTimeout(() => {
      setPollCount((count) => count + 1);
      void membershipQuery.refetch();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [checkoutReturned, entitled, membershipQuery.refetch, pollCount]);

  const verify = async () => {
    setRefreshing(true);
    await membershipQuery.refetch();
    setRefreshing(false);
    setPollCount(10);
  };

  const confirmCancellation = async () => {
    if (cancel.isPending) return;
    setCancelError(null);
    try {
      const updatedStatus = await cancel.mutateAsync();
      queryClient.setQueryData(getGetMembershipStatusQueryKey(), updatedStatus);
      setConfirmCancel(false);
      await membershipQuery.refetch();
    } catch (cause) {
      setCancelError(cause instanceof Error ? cause.message : 'Cancellation could not be completed. Please try again.');
    }
  };

  const period = formatPeriod(status?.renewsAt);
  const isChecking = membershipQuery.isLoading && !status;

  return <div className="account-page">
    <div className="account-wrap">
      <header className="account-top">
        <Link href="/" className="account-brand"><span className="account-brand-mark">A</span>ALLPLAY</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href="/user-portal" className="btn btn-quiet"><ArrowLeft size={14} /> Dashboard</Link>
          <Link href="/feedback" className="btn btn-quiet">Feedback</Link>
          <button className="btn btn-quiet" onClick={() => void signOut({ redirectUrl: basePathForSignout() })}>Sign out</button>
        </div>
      </header>
      <section className="account-hero">
        <div className="account-kicker">Your account / membership</div>
        <h1>Player Projections &amp; Game Takes</h1>
        <p>One membership for the full player table and the owner’s members-only documents and video breakdowns. Available stats, salary values, forecasts and exports are included. Daily game slates and sports news remain free.</p>
      </section>
      <section className="account-panel" aria-labelledby="account-id-title" style={{ marginBottom: 18 }}>
        <h2 id="account-id-title">Your account ID</h2>
        <p className="account-panel-intro">Use this ID to link your account through ALLPLAY’s private owner configuration. Copying an ID does not grant access.</p>
        <code data-testid="owner-account-id" style={{ display: 'block', overflowWrap: 'anywhere', margin: '14px 0' }}>{userId}</code>
        <button className="btn btn-quiet" onClick={async () => {
          try { if (!userId) return; await navigator.clipboard.writeText(userId); setCopyStatus('Account ID copied.'); }
          catch { setCopyStatus('Could not copy automatically. Select and copy the account ID above.'); }
        }}><Copy size={14} /> Copy account ID</button>
        <p role="status" style={{ fontSize: 12 }}>{copyStatus}</p>
      </section>
      <section className="account-panel" aria-labelledby="membership-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div><h2 id="membership-title">Access status</h2><p className="account-panel-intro">{owner ? 'Your account has private, server-verified owner access.' : 'Monthly billing is handled securely by Whop. ALLPLAY unlocks forecasts only after provider verification.'}</p></div>
          {entitled && <span className="account-status-pill"><i className="account-status-dot" /> {owner ? 'Owner access' : 'Verified access'}</span>}
        </div>
        {checkoutReturned && !entitled ? <div className="membership-state" role="status"><span className="membership-state-icon"><Clock3 size={17} /></span><div><h3>Verifying provider payment</h3><p>{unavailable ? 'We could not confirm payment yet. Retry verification below; this page will not mark a return from checkout as success.' : 'Payment can take a short moment to reach ALLPLAY. Access stays locked until Whop confirms it.'}</p></div></div> :
          isChecking ? <div className="membership-state member-loading skeleton" aria-label="Checking membership status" /> :
          unavailable ? <div className="membership-state" role="alert"><span className="membership-state-icon"><CircleAlert size={17} /></span><div><h3>We couldn’t verify membership</h3><p className="member-error">{status?.error || (membershipQuery.error instanceof Error ? membershipQuery.error.message : 'Membership verification is unavailable right now. No access is assumed until the provider confirms it.')}</p></div></div> :
            entitled ? <div className="membership-state"><span className="membership-state-icon"><ShieldCheck size={17} /></span><div><h3>{owner ? 'Owner access is active' : status?.cancelAtPeriodEnd ? 'Renewal is stopped' : 'Player Projections is active'}</h3><p>{owner ? 'All available player projections and projection exports are unlocked. No monthly membership payment is required for this account.' : status?.cancelAtPeriodEnd ? `Your verified access remains available through ${period ?? 'the paid-through date supplied by Whop'}.` : period ? `Your verified membership renews ${period}.` : 'Your membership is verified by Whop.'}</p></div></div> :
                <div className="membership-state"><span className="membership-state-icon"><Check size={17} /></span><div><h3>No active membership</h3><p>{status ? messageForStatus(status.status) : 'Sign in to view membership tied to your ALLPLAY account.'}</p></div></div>}
        {cancelError && <div className="error-box" role="alert" style={{ marginTop: 12 }}>{cancelError}</div>}
        {checkoutReturned && !entitled && <div className="membership-actions"><button className="btn btn-quiet" onClick={() => void verify()} disabled={membershipQuery.isFetching || refreshing}><RefreshCw size={14} className={membershipQuery.isFetching || refreshing ? 'spin' : ''} /> Verify access</button><span className="coverage-detail" style={{ border: 0, padding: 0, margin: 0 }}>Use the same ALLPLAY account on every device.</span></div>}
        {entitled && manageUrl && <div className="membership-actions"><a className="btn btn-quiet" href={manageUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /> Manage billing with Whop</a></div>}
        {owner && <p className="account-panel-intro">Owner access does not cancel an existing Whop subscription. If you previously subscribed, you can stop its renewal below.</p>}
        {entitled && !status?.cancelAtPeriodEnd && <div className="membership-actions"><button className="btn btn-quiet" onClick={() => setConfirmCancel(true)} disabled={cancel.isPending}>{cancel.isPending && <LoaderCircle size={14} className="spin" />}{owner ? 'Stop existing paid renewal' : 'Stop renewal'}</button></div>}
        {!entitled && !unavailable && !checkoutReturned && <div className="membership-actions"><MembershipCheckoutButton signedIn={isSignedIn === true} label="Continue to secure checkout" /></div>}
        {unavailable && <div className="membership-actions"><button className="btn btn-quiet" onClick={() => void verify()} disabled={membershipQuery.isFetching || refreshing}><RefreshCw size={14} className={membershipQuery.isFetching || refreshing ? 'spin' : ''} /> Retry status</button></div>}
        <p className="membership-footnote"><strong>{owner ? 'Owner access: no monthly fee.' : '$1.99 USD / month, plus applicable taxes.'}</strong> Includes player data and Game Takes. ALLPLAY calculates its own stat estimates from historical performances and matchups, not DraftKings, FanDuel or ESPN forecasts. Coverage depends on published data. This initial model is not backtested and does not guarantee an outcome.</p>
      </section>
    </div>
    {confirmCancel && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !cancel.isPending) setConfirmCancel(false); }}>
      <section className="member-confirm" role="alertdialog" aria-modal="true" aria-labelledby="cancel-title" aria-describedby="cancel-copy">
        <h2 id="cancel-title">{owner ? 'Stop an existing paid renewal?' : 'Stop monthly renewal?'}</h2>
        <p id="cancel-copy">{owner ? 'Your owner access stays active. This request only stops an existing paid Whop subscription’s renewal; it does not remove owner access.' : `Your current verified access stays available through ${period ?? 'the paid-through date supplied by Whop'}. The cancellation request only stops future renewal.`}</p>
        <div className="member-confirm-actions"><button className="btn btn-quiet" onClick={() => setConfirmCancel(false)} disabled={cancel.isPending}>Keep membership</button><button className="btn btn-primary" onClick={() => void confirmCancellation()} disabled={cancel.isPending}>{cancel.isPending ? 'Stopping renewal…' : 'Confirm cancellation'}</button></div>
      </section>
    </div>}
  </div>;
}

function basePathForSignout() {
  return import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
}
