import { QueryClientProvider } from '@tanstack/react-query';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { queryClient, useSummary } from './data';
import { t } from './i18n';
import { haptic, setBackButton } from './telegram';
import { Home } from './screens/Home';
import { Review, ReviewFix } from './screens/Review';
import { CategoriesPage, DeletePage, ForwardingPage, ImportPage, RulesPage, Settings } from './screens/Settings';
import { Transactions } from './screens/Transactions';
import { TxDetail } from './screens/TxDetail';
import { ToastHost } from './ui';
import { useEffect } from 'react';

const TABS = [
  { path: '/', icon: '🏠', label: 'nav.home' },
  { path: '/transactions', icon: '🧾', label: 'nav.transactions' },
  { path: '/review', icon: '🔍', label: 'nav.review' },
  { path: '/settings', icon: '⚙️', label: 'nav.settings' },
] as const;

function BottomNav() {
  const [loc] = useLocation();
  const summary = useSummary();
  const review = summary.data?.reviewCount ?? 0;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-sep bg-section/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const active = tab.path === '/' ? loc === '/' : loc.startsWith(tab.path);
          return (
            <Link
              key={tab.path}
              href={tab.path}
              onClick={() => haptic.select()}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${active ? 'text-accent' : 'text-hint'}`}
            >
              <span className={`text-xl ${active ? '' : 'opacity-70 grayscale'}`}>{tab.icon}</span>
              {t(tab.label)}
              {tab.path === '/review' && review > 0 && (
                <span className="absolute right-[calc(50%-1.4rem)] top-1 min-w-4 rounded-full bg-danger px-1 text-[10px] leading-4 text-white">{review}</span>
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
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastHost>
        <Router hook={useHashLocation}>
          <main className="pb-nav mx-auto min-h-screen max-w-md">
            <Switch>
              <Route path="/transactions">
                <TabRoot>
                  <Transactions />
                </TabRoot>
              </Route>
              <Route path="/tx/:id">{(p) => <TxDetail id={Number(p.id)} />}</Route>
              <Route path="/review">
                <TabRoot>
                  <Review />
                </TabRoot>
              </Route>
              <Route path="/review/:id">{(p) => <ReviewFix id={Number(p.id)} />}</Route>
              <Route path="/settings">
                <TabRoot>
                  <Settings />
                </TabRoot>
              </Route>
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
          </main>
          <BottomNav />
        </Router>
      </ToastHost>
    </QueryClientProvider>
  );
}
