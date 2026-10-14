import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Dashboard from '@/pages/dashboard';
import ProjectionsPage from '@/pages/projections';
import Account from '@/pages/account';
import GameTakesPage from '@/pages/game-takes';
import NewsDesk from '@/pages/news-desk';
import FeedbackPage from '@/pages/feedback';
import EvaluationPage from '@/pages/evaluation';
import { Route, Switch, useLocation, Redirect, Router as WouterRouter } from 'wouter';
import { type ReactNode, useEffect, useRef } from 'react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
  },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#e3263a',
    colorForeground: '#e8edf1',
    colorMutedForeground: '#aeb9c5',
    colorDanger: '#e59c94',
    colorBackground: '#141111',
    colorInput: '#0f0c0c',
    colorInputForeground: '#edf1f2',
    colorNeutral: '#776d6a',
    fontFamily: 'Barlow, sans-serif',
    borderRadius: '8px',
  },
  elements: {
    rootBox: 'w-full min-w-0 flex justify-center',
    cardBox: 'bg-[#141111] rounded-xl w-[440px] min-w-0 max-w-full overflow-hidden border border-[#2c2524]',
    card: 'min-w-0 max-w-full !shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#eef2f4]',
    headerSubtitle: 'text-[#bac4cf]',
    socialButtonsBlockButtonText: 'text-[#e7edf1]',
    formFieldLabel: 'text-[#dce3e9]',
    footerActionLink: 'text-[#ff8892]',
    footerActionText: 'text-[#b7c1cb]',
    dividerText: 'text-[#b7c1cb]',
    identityPreviewEditButton: 'text-[#ff8892]',
    formFieldSuccessText: 'text-[#ff8892]',
    alertText: 'text-[#f0c1bb]',
    logoBox: 'rounded-md overflow-hidden',
    logoImage: 'object-contain',
    socialButtonsBlockButton: 'border border-[#3b3230] bg-[#1b1716] hover:bg-[#241e1d]',
    formButtonPrimary: 'bg-[#e3263a] text-[#ffffff] hover:bg-[#ff4d5e]',
    formFieldInput: 'border-[#3b3230] bg-[#0f0c0c] text-[#edf1f2]',
    footerAction: 'border-t border-[#2c2524]',
    dividerLine: 'bg-[#2c2524]',
    alert: 'border-[#8d625e] bg-[#49393d]',
    otpCodeFieldInput: 'border-[#3b3230] bg-[#0f0c0c] text-[#edf1f2]',
    formFieldRow: 'text-[#dce3e9]',
    main: 'min-w-0 max-w-full text-[#e8edf1]',
  },
};

function LoadingAuthShell() {
  return <div className="auth-page"><div className="skeleton" style={{ width: 330, height: 390 }} /></div>;
}

function SignInPage() {
  return <div className="auth-page"><a className="auth-brand-note" href={basePath || '/'}><span className="account-brand-mark">A</span>ALLPLAY</a><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="auth-page"><a className="auth-brand-note" href={basePath || '/'}><span className="account-brand-mark">A</span>ALLPLAY</a><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const signupCheckUserRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  useEffect(() => {
    if (!userId || signupCheckUserRef.current === userId) return;
    signupCheckUserRef.current = userId;
    void fetch(`${basePath}/api/notifications/signup-event`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      signupCheckUserRef.current = null;
    });
  }, [userId]);

  return null;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingAuthShell />;
  return isSignedIn ? <Redirect to="/user-portal" /> : <Dashboard />;
}

function UserPortal() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingAuthShell />;
  return isSignedIn ? <Dashboard /> : <Redirect to="/" />;
}

function AccountRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingAuthShell />;
  return isSignedIn ? <Account /> : <Redirect to="/sign-in" />;
}

function EvaluationRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <LoadingAuthShell />;
  return isSignedIn ? <EvaluationPage /> : <Redirect to="/sign-in" />;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/user-portal" component={UserPortal} />
        <Route path="/projections" component={ProjectionsPage} />
        <Route path="/takes" component={GameTakesPage} />
        <Route path="/news" component={NewsDesk} />
        <Route path="/account" component={AccountRoute} />
        <Route path="/feedback" component={FeedbackPage} />
        <Route path="/evaluation" component={EvaluationRoute} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your ALLPLAY account' } },
        signUp: { start: { title: 'Join ALLPLAY', subtitle: 'Your sports dashboard starts here' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <Router />
    </ClerkProvider>
  );
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
