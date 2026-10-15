import { ClipboardCheck, FileText, History, LayoutGrid, ListChecks, Settings, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Matching rule for the active state; defaults to an exact/prefix match on `href`. */
  match?: (pathname: string) => boolean;
}

/** Primary navigation (FDD §5). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/overview', label: 'Overview', icon: LayoutGrid },
  {
    href: '/runs',
    label: 'Research Runs',
    icon: ListChecks,
    match: (pathname) => pathname === '/runs' || pathname.startsWith('/runs/'),
  },
  {
    href: '/approvals',
    label: 'Approvals',
    icon: ClipboardCheck,
    match: (pathname) => pathname === '/approvals' || pathname.startsWith('/approvals/'),
  },
  {
    href: '/refund-proposals',
    label: 'Refund Proposals',
    icon: FileText,
    match: (pathname) => pathname === '/refund-proposals' || pathname.startsWith('/refund-proposals/'),
  },
  { href: '/ledger', label: 'Settlement Ledger', icon: Wallet },
  {
    href: '/audit',
    label: 'Audit Trail',
    icon: History,
    match: (pathname) => pathname === '/audit' || pathname.startsWith('/audit/'),
  },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Human title for the top bar, derived from the route (FDD §6.1). */
export function routeTitle(pathname: string): string {
  if (pathname === '/overview') return 'Overview';
  if (pathname === '/runs') return 'Research Runs';
  if (pathname === '/runs/new') return 'New Research Run';
  if (pathname.startsWith('/runs/')) return 'Research Run';
  if (pathname === '/approvals') return 'Approvals';
  if (pathname.startsWith('/approvals/')) return 'Approval Detail';
  if (pathname === '/refund-proposals') return 'Refund Proposals';
  if (pathname.startsWith('/refund-proposals/')) return 'Refund Proposal';
  if (pathname === '/ledger') return 'Settlement Ledger';
  if (pathname === '/audit') return 'Audit Trail';
  if (pathname === '/settings') return 'Settings';
  return 'LedgerFlow';
}
