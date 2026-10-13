import { ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Dashboard from '@/pages/dashboard';
import Account from '@/pages/account';
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
    colorPrimary: '#98dbb5',
    colorForeground: '#e8edf1',
    colorMutedForeground: '#aeb9c5',
    colorDanger: '#e59c94',
    colorBackground: '#343b49',
    colorInput: '#303744',
    colorInputForeground: '#edf1f2',
    colorNeutral: '#707b8d',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '8px',
  },
  elements: {
    rootBox: 'w-full min-w-0 flex justify-center',
    cardBox: 'bg-[#343b49] rounded-xl w-[440px] min-w-0 max-w-full overflow-hidden border border-[#606b7b]',
    card: 'min-w-0 max-w-full !shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#eef2f4]',
    headerSubtitle: 'text-[#bac4cf]',
    socialButtonsBlockButtonText: 'text-[#e7edf1]',
    formFieldLabel: 'text-[#dce3e9]',
    footerActionLink: 'text-[#a9e4c1]',
    footerActionText: 'text-[#b7c1cb]',
    dividerText: 'text-[#b7c1cb]',
    identityPreviewEditButton: 'text-[#a9e4c1]',
    formFieldSuccessText: 'text-[#a9e4c1]',
    alertText: 'text-[#f0c1bb]',
    logoBox: 'rounded-md overflow-hidden',
    logoImage: 'object-contain',
    socialButtonsBlockButton: 'border border-[#697486] bg-[#3c4554] hover:bg-[#465263]',
    formButtonPrimary: 'bg-[#98dbb5] text-[#243b34] hover:bg-[#afe9c8]',
    formFieldInput: 'border-[#697486] bg-[#303744] text-[#edf1f2]',
    footerAction: 'border-t border-[#596475]',
    dividerLine: 'bg-[#596475]',
    alert: 'border-[#8d625e] bg-[#49393d]',
    otpCodeFieldInput: 'border-[#697486] bg-[#303744] text-[#edf1f2]',
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
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

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

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/user-portal" component={UserPortal} />
        <Route path="/account" component={AccountRoute} />
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
