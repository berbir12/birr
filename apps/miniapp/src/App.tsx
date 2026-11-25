import { QueryClientProvider } from '@tanstack/react-query';
import { ChartPie, House, ReceiptText, Settings as SettingsIcon, Target, type LucideIcon } from 'lucide-react';
import { Component, useEffect } from 'react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { queryClient, useSummary } from './data';
import { t, type MsgKey } from './i18n';
import { Home } from './screens/Home';
import { Insights } from './screens/Insights';
import { PeoplePage, PersonPage } from './screens/People';
import { Plan } from './screens/Plan';
import { RecurringPage } from './screens/Recurring';
import { Review, ReviewFix } from './screens/Review';
import { CategoriesPage, DeletePage, ForwardingPage, ImportPage, RulesPage, Settings } from './screens/Settings';
import { Transactions } from './screens/Transactions';
import { TxDetail } from './screens/TxDetail';
import { haptic, setBackButton } from './telegram';
import { ToastHost } from './ui';

const TABS: Array<{ path: string; icon: LucideIcon; label: MsgKey }> = [
  { path: '/', icon: House, label: 'nav.home' },
  { path: '/transactions', icon: ReceiptText, label: 'nav.transactions' },
  { path: '/insights', icon: ChartPie, label: 'nav.insights' },
  { path: '/plan', icon: Target, label: 'nav.plan' },
  { path: '/settings', icon: SettingsIcon, label: 'nav.settings' },
];

function BottomNav() {
  const [loc] = useLocation();
  const summary = useSummary();
  const review = summary.data?.reviewCount ?? 0;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sep bg-section/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-md px-2">
        {TABS.map(({ path, icon: Icon, label }) => {
          const active = path === '/' ? loc === '/' : loc.startsWith(path);
          return (
            <Link
              key={path}
              href={path}
              onClick={() => haptic.select()}
              className={`relative flex flex-1 flex-col items-center gap-1 pb-1.5 pt-2 text-[10.5px] font-medium transition-colors ${active ? 'text-accent' : 'text-hint'}`}
            >
              <Icon size={23} strokeWidth={active ? 2.3 : 1.8} />
              {t(label)}
              {path === '/settings' && review > 0 && (
                <span className="absolute left-[calc(50%+6px)] top-1 min-w-[17px] rounded-full bg-danger px-1 text-center text-[10px] font-bold leading-[17px] text-white">{review}</span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Tabs hide Telegram's BackButton; detail screens show it via useBackButton. */
function TabRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => setBackButton(null), []);
  return <div className="animate-fade">{children}</div>;
}

function ScrollToTop() {
  const [loc] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc]);
  return null;
}

/** A crash in one screen shows a recoverable message instead of a blank app. */
class ErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[birr] render error', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-8 text-center">
        <p className="mb-1 text-[17px] font-semibold">{t('common.error')}</p>
        <button
          className="mt-3 rounded-[14px] bg-accent px-5 py-2.5 font-semibold text-accent-text"
          onClick={() => {
            location.hash = '#/';
            location.reload();
          }}
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastHost>
        <Router hook={useHashLocation}>
          <ScrollToTop />
          <main className="pb-nav mx-auto min-h-screen max-w-md">
            <ErrorBoundary>
            <Switch>
              <Route path="/transactions">
                <TabRoot>
                  <Transactions />
                </TabRoot>
              </Route>
              <Route path="/insights">
                <TabRoot>
                  <Insights />
                </TabRoot>
              </Route>
              <Route path="/plan">
                <TabRoot>
                  <Plan />
                </TabRoot>
              </Route>
              <Route path="/settings">
                <TabRoot>
                  <Settings />
                </TabRoot>
              </Route>
              <Route path="/tx/:id">{(p) => <TxDetail id={Number(p.id)} />}</Route>
              <Route path="/review" component={Review} />
              <Route path="/review/:id">{(p) => <ReviewFix id={Number(p.id)} />}</Route>
              <Route path="/people" component={PeoplePage} />
              <Route path="/people/:id">{(p) => <PersonPage id={Number(p.id)} />}</Route>
              <Route path="/recurring" component={RecurringPage} />
              <Route path="/settings/categories" component={CategoriesPage} />
              <Route path="/settings/rules" component={RulesPage} />
              <Route path="/settings/forwarding" component={ForwardingPage} />
              <Route path="/settings/import" component={ImportPage} />
              <Route path="/settings/delete" component={DeletePage} />
              <Route>
                <TabRoot>
                  <Home />
                </TabRoot>
              </Route>
            </Switch>
            </ErrorBoundary>
          </main>
          <BottomNav />
        </Router>
      </ToastHost>
    </QueryClientProvider>
  );
}
