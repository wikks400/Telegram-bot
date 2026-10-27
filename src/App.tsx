import React, { useState, useEffect } from 'react';
import {
  Flame,
  ShoppingCart,
  Wallet,
  FolderTree,
  Activity,
  Terminal,
  Settings as SettingsIcon,
  HelpCircle,
  Play,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Download,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
  Edit2,
  Layers,
  ShieldCheck,
  Check,
  ChevronRight,
  Database,
  Globe,
  Radio,
} from 'lucide-react';
import {
  DashboardStats,
  TrackedWallet,
  WalletGroup,
  ConsolidatedAlert,
  OpenSeaChain,
  SystemLog,
} from './types.ts';

type Tab = 'dashboard' | 'alerts' | 'telegram' | 'wallets' | 'groups' | 'chains' | 'tests' | 'deploy';

async function safeFetchJson<T>(url: string, defaultValue: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return defaultValue;
    const data = await res.json();
    return data ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

export default function App() {
  const [currentTab, setCurrentTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [groups, setGroups] = useState<WalletGroup[]>([]);
  const [alerts, setAlerts] = useState<ConsolidatedAlert[]>([]);
  const [chains, setChains] = useState<OpenSeaChain[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Telegram Simulator State
  const [chatMessages, setChatMessages] = useState<
    { sender: 'user' | 'bot'; text: string; buttons?: string[]; timestamp: string }[]
  >([
    {
      sender: 'bot',
      text: `👋 *Welcome to NFT Smart Money Alert Bot!*\n\nReal-time monitoring of NFT mints and purchases across chains using OpenSea API v2.\n\nClick any button below or type a command like \`/dashboard\` or \`/wallets\`.`,
      buttons: [
        '📊 Dashboard',
        '👛 Manage Wallets',
        '📁 Wallet Groups',
        '🔥 Recent Mint Alerts',
        '🛒 Recent Purchase Alerts',
        '⚙️ Settings',
        '❓ Help',
      ],
      timestamp: 'Just now',
    },
  ]);
  const [inputCommand, setInputCommand] = useState('');

  // Modals & form state
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [newWalletAddress, setNewWalletAddress] = useState('');
  const [newWalletLabel, setNewWalletLabel] = useState('');
  const [newWalletChain, setNewWalletChain] = useState<'evm' | 'solana' | 'flow'>('evm');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [walletFormError, setWalletFormError] = useState('');

  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  // Bulk Add Wallets Modal state
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [bulkTargetGroupId, setBulkTargetGroupId] = useState('');
  const [bulkRawInput, setBulkRawInput] = useState('');
  const [bulkResultMsg, setBulkResultMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Test Runner State
  const [testResults, setTestResults] = useState<{
    results: { title: string; category: string; passed: boolean; message?: string; durationMs: number }[];
    summary: { total: number; passed: number; failed: number };
  } | null>(null);
  const [runningTests, setRunningTests] = useState(false);

  // Fetch initial data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [statsRes, walletsRes, groupsRes, alertsRes, chainsRes, logsRes] = await Promise.all([
        safeFetchJson<any>('/api/dashboard', null),
        safeFetchJson<any[]>('/api/wallets', []),
        safeFetchJson<any[]>('/api/groups', []),
        safeFetchJson<any[]>('/api/alerts?limit=30', []),
        safeFetchJson<any[]>('/api/chains', []),
        safeFetchJson<any[]>('/api/logs', []),
      ]);

      if (statsRes && !statsRes.error) setStats(statsRes);
      if (Array.isArray(walletsRes)) setWallets(walletsRes);
      if (Array.isArray(groupsRes)) setGroups(groupsRes);
      if (Array.isArray(alertsRes)) setAlerts(alertsRes);
      if (Array.isArray(chainsRes)) setChains(chainsRes);
      if (Array.isArray(logsRes)) setLogs(logsRes);
    } catch {
      // Graceful fallback during server restarts or transient offline states
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Telegram simulation
  const handleSendTelegramCommand = async (cmd: string) => {
    if (!cmd.trim()) return;
    const userMsg = {
      sender: 'user' as const,
      text: cmd,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setInputCommand('');

    try {
      const res = await fetch('/api/telegram/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      }).then((r) => r.json());

      const botMsg = {
        sender: 'bot' as const,
        text: res.text || 'No response',
        buttons: res.buttons,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setChatMessages((prev) => [...prev, botMsg]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          sender: 'bot',
          text: '⚠️ Communication error with Telegram Simulator service.',
          timestamp: 'Now',
        },
      ]);
    }
  };

  const handleButtonClick = (btnText: string) => {
    const map: Record<string, string> = {
      '📊 Dashboard': '/dashboard',
      '👛 Manage Wallets': '/wallets',
      '📁 Wallet Groups': '/groups',
      '🔥 Recent Mint Alerts': '/mints',
      '🛒 Recent Purchase Alerts': '/buys',
      '⚙️ Settings': '/settings',
      '❓ Help': '/help',
      '🧪 Test Alert': '/testalert',
    };
    const command = map[btnText] || btnText;
    handleSendTelegramCommand(command);
  };

  // Trigger simulated alert
  const [alertFeedback, setAlertFeedback] = useState<string | null>(null);

  const handleSimulateAlert = async (type: 'mint' | 'buy', count: number = 3) => {
    setLoading(true);
    setAlertFeedback(null);
    try {
      const defaultCollection =
        type === 'mint'
          ? { slug: 'pudgypenguins', name: 'Pudgy Penguins', chain: 'ethereum' }
          : { slug: 'milady', name: 'Milady Maker', chain: 'ethereum' };

      const res = await fetch('/api/alerts/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          collectionSlug: defaultCollection.slug,
          collectionName: defaultCollection.name,
          chain: defaultCollection.chain,
          targetWalletsCount: count,
        }),
      });

      const data = await res.json();
      await fetchData();

      if (data?.suppressed) {
        setAlertFeedback(data.message || `Suppressed: Only ${count} wallet(s). Threshold is 3 unique wallets.`);
      } else if (data?.success) {
        setAlertFeedback(data.message || `Alert generated for ${count} unique wallets!`);
        setCurrentTab('alerts');
      }
    } catch (err: any) {
      setAlertFeedback(`Simulation error: ${err.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setAlertFeedback(null), 5000);
    }
  };

  const handleClearAlerts = async () => {
    setLoading(true);
    try {
      await fetch('/api/alerts/clear', { method: 'POST' });
      await fetchData();
      setAlertFeedback('All alerts and milestone records successfully purged.');
    } catch (err: any) {
      setAlertFeedback(`Error clearing alerts: ${err.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setAlertFeedback(null), 4000);
    }
  };

  // Run tests
  const handleRunTests = async () => {
    setRunningTests(true);
    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTestResults(data);
        setCurrentTab('tests');
      }
    } catch {
      // Ignored
    } finally {
      setRunningTests(false);
    }
  };

  // Add wallet
  const handleAddWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalletFormError('');
    try {
      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: newWalletAddress,
          label: newWalletLabel,
          chainType: newWalletChain,
          groupIds: selectedGroupIds,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setWalletFormError(errData.error || 'Failed to add wallet');
        return;
      }

      setShowAddWalletModal(false);
      setNewWalletAddress('');
      setNewWalletLabel('');
      setSelectedGroupIds([]);
      await fetchData();
    } catch (err: any) {
      setWalletFormError(err.message || 'Network error');
    }
  };

  // Delete wallet
  const handleDeleteWallet = async (address: string) => {
    try {
      await fetch(`/api/wallets/${encodeURIComponent(address)}`, { method: 'DELETE' });
      await fetchData();
    } catch {
      // Ignored
    }
  };

  // Bulk add wallets
  const handleBulkAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkTargetGroupId.trim() || !bulkRawInput.trim()) return;
    setBulkLoading(true);
    setBulkResultMsg(null);
    try {
      const res = await fetch('/api/wallets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: bulkTargetGroupId,
          rawText: bulkRawInput,
        }),
      });

      const data = await res.json().catch(() => ({ error: 'Failed to process request' }));

      if (data.error) {
        setBulkResultMsg({ type: 'error', text: data.error });
      } else {
        setBulkResultMsg({
          type: 'success',
          text: `Added ${data.addedCount} wallet(s) to ${data.group?.name || 'group'}!${data.errors?.length > 0 ? ` (${data.errors.length} invalid addresses skipped)` : ''}`,
        });
        setBulkRawInput('');
        await fetchData();
      }
    } catch (err: any) {
      setBulkResultMsg({ type: 'error', text: err.message || 'Request failed' });
    } finally {
      setBulkLoading(false);
    }
  };

  // Clear all wallets
  const handleClearAllWallets = async () => {
    try {
      await fetch('/api/wallets/clear', { method: 'POST' });
      await fetchData();
    } catch {
      // Ignored
    }
  };

  // Add group
  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    try {
      await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName, description: newGroupDesc }),
      });
      setShowAddGroupModal(false);
      setNewGroupName('');
      setNewGroupDesc('');
      await fetchData();
    } catch {
      // Ignored
    }
  };

  // Delete group
  const handleDeleteGroup = async (id: string, _name: string) => {
    try {
      await fetch(`/api/groups/${id}`, { method: 'DELETE' });
      await fetchData();
    } catch {
      // Ignored
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
            <Flame className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-white">SmartMoney Bot</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Radio className="w-3 h-3 animate-pulse" /> OpenSea v2
              </span>
            </div>
            <p className="text-xs text-slate-400">Telegram NFT Smart Money Alert & Wallet Tracking</p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSimulateAlert('mint')}
            className="text-xs px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium flex items-center gap-1.5 transition shadow"
          >
            <Flame className="w-3.5 h-3.5" /> Simulate Mint
          </button>
          <button
            onClick={() => handleSimulateAlert('buy')}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5 transition shadow"
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Simulate Buy
          </button>
          <button
            onClick={handleRunTests}
            disabled={runningTests}
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition disabled:opacity-50 shadow"
          >
            <Play className="w-3.5 h-3.5" /> {runningTests ? 'Testing...' : 'Run 16 Tests'}
          </button>
          <a
            href="/api/download-zip"
            download="telegram-nft-smart-money-bot.zip"
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium flex items-center gap-1.5 transition shadow"
          >
            <Download className="w-3.5 h-3.5" /> Download ZIP
          </a>
          <button
            onClick={fetchData}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-800 bg-slate-900/50 px-4 lg:px-8">
        <nav className="flex space-x-1 overflow-x-auto py-2">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: Activity, count: null },
            { id: 'alerts', label: 'Live Alerts Feed', icon: Flame, count: alerts.length },
            { id: 'telegram', label: 'Telegram Console', icon: Terminal, count: null },
            { id: 'wallets', label: 'Tracked Wallets', icon: Wallet, count: wallets.length },
            { id: 'groups', label: 'Wallet Groups', icon: FolderTree, count: groups.length },
            { id: 'chains', label: 'Chains & OpenSea v2', icon: Globe, count: chains.length },
            { id: 'tests', label: 'Automated Tests', icon: CheckCircle2, count: testResults ? `${testResults.summary.passed}/16` : '16' },
            { id: 'deploy', label: 'Botkeep Deploy', icon: ShieldCheck, count: null },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id as Tab)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                  active
                    ? 'bg-slate-800 text-amber-400 shadow-sm border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-amber-400' : 'text-slate-400'}`} />
                {tab.label}
                {tab.count !== null && (
                  <span
                    className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                      active ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto">
        {/* DASHBOARD TAB */}
        {currentTab === 'dashboard' && stats && (
          <div className="space-y-6">
            {/* Top Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 font-medium">Tracked Wallets</span>
                <div className="text-2xl font-bold text-white mt-1">{stats.trackedWalletsCount}</div>
                <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                  <Check className="w-3 h-3" /> {stats.activeWalletsCount} Active
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 font-medium">Wallet Groups</span>
                <div className="text-2xl font-bold text-white mt-1">{stats.groupsCount}</div>
                <div className="text-xs text-slate-400 mt-1">Multi-membership</div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 font-medium">Supported Chains</span>
                <div className="text-2xl font-bold text-white mt-1">{stats.supportedChainsCount}</div>
                <div className="text-xs text-indigo-400 mt-1">{stats.monitoredChainsCount} Actively Monitored</div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 font-medium">Unique Minters</span>
                <div className="text-2xl font-bold text-orange-400 mt-1">{stats.uniqueMintersCount}</div>
                <div className="text-xs text-slate-400 mt-1">{stats.nftsMintedCount} NFTs Minted</div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 font-medium">Unique Buyers</span>
                <div className="text-2xl font-bold text-emerald-400 mt-1">{stats.uniqueBuyersCount}</div>
                <div className="text-xs text-slate-400 mt-1">{stats.nftsPurchasedCount} NFTs Bought</div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Poll Interval</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                    Rate safe
                  </span>
                </div>
                <div className="text-2xl font-bold text-white mt-1">
                  {(stats?.pollIntervalSeconds && stats.pollIntervalSeconds < 1000) ? stats.pollIntervalSeconds : 10}s
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  {[5, 10, 15, 30].map((sec) => (
                    <button
                      key={sec}
                      onClick={async () => {
                        await fetch('/api/settings/interval', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ intervalSeconds: sec }),
                        });
                        await fetchData();
                      }}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition ${
                        ((stats?.pollIntervalSeconds && stats.pollIntervalSeconds < 1000) ? stats.pollIntervalSeconds : 10) === sec
                          ? 'bg-amber-600 border-amber-500 text-white font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Status & Bot Architecture Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-850 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-amber-400">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-base">Persistent SQLite Engine Active</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Path: <code className="text-amber-300 bg-slate-800 px-1.5 py-0.5 rounded">{process.env.DATABASE_PATH || './data/nft_bot.sqlite'}</code> • Group memberships, deduplication hashes, and collection caches survive restarts.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs">
                <div className="bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700">
                  <span className="text-slate-400">Telegram Bot: </span>
                  <span className={stats.botStatus.tokenConfigured ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                    {stats.botStatus.tokenConfigured ? '🟢 Live' : '🟡 Simulator Ready'}
                  </span>
                </div>
                <div className="bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700">
                  <span className="text-slate-400">Auth: </span>
                  <span className="text-white font-medium">
                    {stats.botStatus.isAdminConfigured ? '👮 Admin Protected' : '🔓 Open Access'}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions & Recent Activity Feed Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left 2 Cols: Recent Alerts */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Flame className="w-4 h-4 text-orange-400" /> Recent Consolidated Alerts
                  </h3>
                  <button
                    onClick={() => setCurrentTab('alerts')}
                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-medium"
                  >
                    View All ({alerts.length}) <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {alerts.length === 0 ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
                    <p className="text-sm text-slate-400">No alerts captured yet.</p>
                    <div className="mt-3 flex justify-center gap-2">
                      <button
                        onClick={() => handleSimulateAlert('mint')}
                        className="text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-500 rounded-lg text-white font-medium"
                      >
                        Simulate Mint Alert
                      </button>
                      <button
                        onClick={() => handleSimulateAlert('buy')}
                        className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium"
                      >
                        Simulate Buy Alert
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {alerts.slice(0, 3).map((a) => (
                      <div
                        key={a.id}
                        className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1 ${
                              a.alertType === 'mint'
                                ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {a.alertType === 'mint' ? <Flame className="w-3 h-3" /> : <ShoppingCart className="w-3 h-3" />}
                            {a.alertType === 'mint' ? 'Mint Alert' : 'Buy Alert'}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">
                            {new Date(a.timestamp).toLocaleTimeString()}
                          </span>
                        </div>

                        <div className="text-white font-semibold text-base mb-1">{a.collectionName}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-3 mb-3">
                          <span>Chain: <strong className="text-slate-200 capitalize">{a.chain}</strong></span>
                          <span>•</span>
                          <span>Unique Wallets: <strong className="text-slate-200">{a.totalUniqueWallets}</strong></span>
                          <span>•</span>
                          <span>NFTs: <strong className="text-slate-200">{a.totalNFTs}</strong></span>
                        </div>

                        <div className="bg-slate-950 rounded-lg p-2.5 font-mono text-xs text-slate-300 border border-slate-850 whitespace-pre-line leading-relaxed">
                          {a.formattedMessage}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Col: System Logs & Operational Status */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-indigo-400" /> System & API Logs
                  </h3>
                  <span className="text-xs text-slate-400 font-mono">{logs.length} entries</span>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 h-96 overflow-y-auto space-y-2 font-mono text-xs">
                  {logs.length === 0 ? (
                    <div className="text-slate-500 text-center py-8">No system logs recorded yet.</div>
                  ) : (
                    logs.map((log, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded border ${
                          log.level === 'error'
                            ? 'bg-red-950/30 border-red-900/50 text-red-300'
                            : log.level === 'warn'
                            ? 'bg-amber-950/30 border-amber-900/50 text-amber-300'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                          <span className="uppercase font-bold tracking-wider">{log.category}</span>
                          <span>{new Date(log.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div>{log.message}</div>
                        {log.details && (
                          <div className="text-[10px] text-slate-400 mt-1 truncate">{log.details}</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ALERTS FEED TAB */}
        {currentTab === 'alerts' && (
          <div className="space-y-6">
            {/* Feedback notification toast / banner */}
            {alertFeedback && (
              <div className="bg-amber-950/60 border border-amber-600/50 rounded-xl p-3 px-4 text-xs text-amber-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{alertFeedback}</span>
                </div>
                <button onClick={() => setAlertFeedback(null)} className="text-amber-400 hover:text-white font-bold ml-2">
                  ✕
                </button>
              </div>
            )}

            {/* Threshold Rules Info Card */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-850 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold uppercase tracking-wider">
                    Threshold Milestones
                  </span>
                  <h3 className="font-semibold text-white text-sm">Strict Anti-Spam Notification Milestones</h3>
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                  Alerts are strictly suppressed for 1 or 2 wallets to prevent spam. Alerts fire ONLY at:
                  <strong className="text-amber-300 ml-1">3 Wallets (Milestone 1)</strong>,
                  <strong className="text-amber-300 ml-1">6 Wallets (Milestone 2)</strong>,
                  <strong className="text-amber-300 ml-1">10 Wallets (Milestone 3)</strong>, and
                  <strong className="text-amber-300 ml-1">15 Wallets (Milestone 4)</strong>.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {alerts.length > 0 && (
                  <button
                    onClick={handleClearAlerts}
                    className="text-xs px-3 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800 font-medium flex items-center gap-1.5 transition"
                    title="Clear alert history and reset milestones"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear History
                  </button>
                )}
              </div>
            </div>

            {/* Simulation Bar with Threshold Milestones */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-400" /> Milestone Alert Simulator
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Test milestone triggering across groups or verify 1-2 wallet suppression.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleSimulateAlert('mint', 1)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  title="Test 1 wallet (will be suppressed)"
                >
                  1 Wallet (Suppressed)
                </button>
                <button
                  onClick={() => handleSimulateAlert('mint', 3)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium flex items-center gap-1 transition shadow"
                  title="Trigger Milestone 1 (3 unique wallets)"
                >
                  <Flame className="w-3 h-3" /> 3 Wallets (M1)
                </button>
                <button
                  onClick={() => handleSimulateAlert('mint', 6)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-1 transition shadow"
                  title="Trigger Milestone 2 (6 unique wallets)"
                >
                  <Flame className="w-3 h-3" /> 6 Wallets (M2)
                </button>
                <button
                  onClick={() => handleSimulateAlert('buy', 10)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1 transition shadow"
                  title="Trigger Milestone 3 (10 unique wallets)"
                >
                  <ShoppingCart className="w-3 h-3" /> 10 Wallets (M3)
                </button>
                <button
                  onClick={() => handleSimulateAlert('buy', 15)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium flex items-center gap-1 transition shadow"
                  title="Trigger Milestone 4 (15 unique wallets)"
                >
                  <ShoppingCart className="w-3 h-3" /> 15 Wallets (M4)
                </button>
              </div>
            </div>

            {alerts.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
                <Flame className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white">No NFT Alerts Generated Yet</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-4">
                  When tracked smart money wallets execute mints or confirmed purchases reaching milestone thresholds (3, 6, 10, 15 unique wallets), consolidated alerts will stream here and broadcast to Telegram.
                </p>
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => handleSimulateAlert('mint', 3)}
                    className="text-xs px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-medium"
                  >
                    Simulate 3 Wallets Mint Alert (Milestone 1)
                  </button>
                  <button
                    onClick={() => handleSimulateAlert('buy', 6)}
                    className="text-xs px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium"
                  >
                    Simulate 6 Wallets Buy Alert (Milestone 2)
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className={`text-xs px-2.5 py-1 rounded font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                            alert.alertType === 'mint'
                              ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {alert.alertType === 'mint' ? <Flame className="w-3.5 h-3.5" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                          {alert.alertType === 'mint' ? 'SMART MONEY MINT' : 'SMART MONEY BUY'}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopy(alert.formattedMessage, alert.id)}
                            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1 transition"
                            title="Copy Markdown"
                          >
                            {copiedId === alert.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            {copiedId === alert.id ? 'Copied' : 'Copy'}
                          </button>
                          <a
                            href={alert.openseaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1 transition"
                          >
                            <ExternalLink className="w-3 h-3" /> OpenSea
                          </a>
                        </div>
                      </div>

                      {/* Exact Telegram Rendered Preview */}
                      <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-xs text-slate-200 whitespace-pre-line leading-relaxed selection:bg-amber-500 selection:text-black">
                        {alert.formattedMessage}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                      <span>Events aggregated: <strong className="text-slate-200">{alert.eventsCount}</strong></span>
                      <span>{new Date(alert.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TELEGRAM CONSOLE TAB */}
        {currentTab === 'telegram' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Interactive Phone / Chat Simulator */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-[650px] shadow-2xl">
              {/* Telegram Window Header */}
              <div className="bg-slate-850 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-amber-500 to-orange-600 flex items-center justify-center font-bold text-white text-xs">
                    ⚡
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white flex items-center gap-2">
                      NFT Smart Money Alert Bot
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">bot</span>
                    </div>
                    <div className="text-[11px] text-slate-400">@SmartMoneyNFTBot • Telegraf Engine</div>
                  </div>
                </div>
                <button
                  onClick={() =>
                    setChatMessages([
                      {
                        sender: 'bot',
                        text: '👋 *Welcome to NFT Smart Money Alert Bot!*\n\nReal-time monitoring of NFT mints and purchases across chains using OpenSea API v2.',
                        buttons: ['📊 Dashboard', '👛 Manage Wallets', '📁 Wallet Groups', '🔥 Recent Mint Alerts', '🛒 Recent Purchase Alerts', '⚙️ Settings', '❓ Help'],
                        timestamp: 'Now',
                      },
                    ])
                  }
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800"
                >
                  Clear Chat
                </button>
              </div>

              {/* Chat Message List */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-950/70">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed whitespace-pre-line shadow ${
                        msg.sender === 'user'
                          ? 'bg-amber-600 text-white rounded-br-none'
                          : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-none font-mono'
                      }`}
                    >
                      {msg.text}

                      {/* Interactive Telegram Inline Buttons */}
                      {msg.buttons && msg.buttons.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-1.5">
                          {msg.buttons.map((btn, bIdx) => (
                            <button
                              key={bIdx}
                              onClick={() => handleButtonClick(btn)}
                              className="text-[11px] px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded font-sans font-medium text-center transition border border-slate-700/60"
                            >
                              {btn}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
                  </div>
                ))}
              </div>

              {/* Message Input Box */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendTelegramCommand(inputCommand);
                }}
                className="p-3 bg-slate-900 border-t border-slate-800 flex gap-2"
              >
                <input
                  type="text"
                  value={inputCommand}
                  onChange={(e) => setInputCommand(e.target.value)}
                  placeholder="Type a command (e.g. /dashboard, /wallets, /groups, /testalert)..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 font-mono"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition"
                >
                  Send
                </button>
              </form>
            </div>

            {/* Quick Command Reference & Info */}
            <div className="space-y-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2 mb-2">
                  <Terminal className="w-4 h-4 text-amber-400" /> Telegram Quick Commands
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Click any command to test it instantly in the simulator:
                </p>

                <div className="space-y-1.5">
                  {[
                    { cmd: '/start', desc: 'Main interactive menu' },
                    { cmd: '/dashboard', desc: 'View statistics & metrics' },
                    { cmd: '/wallets', desc: 'List tracked wallets & groups' },
                    { cmd: '/groups', desc: 'List wallet groups' },
                    { cmd: '/mints', desc: 'View recent NFT mints' },
                    { cmd: '/buys', desc: 'View recent NFT purchases' },
                    { cmd: '/addwallets Alpha 0x1111111111111111111111111111111111111111 0x2222222222222222222222222222222222222222', desc: 'Bulk add wallets to group' },
                    { cmd: '/clearwallets', desc: 'Delete all tracked wallets' },
                    { cmd: '/settings', desc: 'View bot configuration' },
                    { cmd: '/testalert', desc: 'Trigger formatted test alert' },
                    { cmd: '/help', desc: 'Full commands manual' },
                  ].map((c) => (
                    <button
                      key={c.cmd}
                      onClick={() => handleSendTelegramCommand(c.cmd)}
                      className="w-full text-left p-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-850 flex items-center justify-between text-xs transition"
                    >
                      <code className="text-amber-400 font-bold">{c.cmd}</code>
                      <span className="text-slate-400">{c.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" /> Bot Security & Admins
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Only Telegram users whose IDs match <code>TELEGRAM_ADMIN_IDS</code> can execute sensitive commands like adding or deleting wallets and groups.
                </p>
                <div className="mt-3 text-xs bg-slate-950 p-2.5 rounded border border-slate-800 text-slate-300">
                  Current Admin IDs:{' '}
                  <strong className="text-amber-300">
                    {process.env.TELEGRAM_ADMIN_IDS || '123456789 (Default)'}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* WALLETS TAB */}
        {currentTab === 'wallets' && (
          <div className="space-y-6">
            {/* Threshold policy banner in Wallets tab */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center font-bold">
                  🎯
                </div>
                <div>
                  <div className="text-white font-semibold">Milestone Alerting Policy Active</div>
                  <div className="text-slate-400 text-[11px]">
                    Alerts trigger ONLY when <strong className="text-amber-300">3, 6, 10, or 15 unique wallets</strong> across any group mint or buy an NFT. 1 or 2 wallets are suppressed.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Thresholds: 3 → 6 → 10 → 15
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-amber-400" /> Tracked Smart Money Wallets ({wallets.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Import single wallets or bulk import multiple wallets at once into groups.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowAddWalletModal(true)}
                  className="text-xs px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition shadow"
                  title="Add a single wallet address with custom label and groups"
                >
                  <Plus className="w-4 h-4" /> Add Single Wallet
                </button>
                <button
                  onClick={() => {
                    setBulkTargetGroupId(groups[0]?.id || '');
                    setShowBulkAddModal(true);
                  }}
                  className="text-xs px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-1.5 transition shadow"
                  title="Paste multiple wallet addresses at once into a group"
                >
                  <Layers className="w-4 h-4" /> Import Multiple Wallets
                </button>
                {wallets.length > 0 && (
                  <button
                    onClick={handleClearAllWallets}
                    className="text-xs px-3 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800 font-medium flex items-center gap-1.5 transition"
                    title="Delete all tracked wallets"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear All Wallets
                  </button>
                )}
              </div>
            </div>

            {wallets.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
                <Wallet className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white">No Tracked Wallets Configured</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-5">
                  Select your preferred import method below to start tracking smart money:
                </p>
                <div className="flex flex-col sm:flex-row justify-center items-center gap-3">
                  <button
                    onClick={() => setShowAddWalletModal(true)}
                    className="w-full sm:w-auto text-xs px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg shadow flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add Single Wallet
                  </button>
                  <button
                    onClick={() => {
                      setBulkTargetGroupId(groups[0]?.id || '');
                      setShowBulkAddModal(true);
                    }}
                    className="w-full sm:w-auto text-xs px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg shadow flex items-center justify-center gap-2"
                  >
                    <Layers className="w-4 h-4" /> Import Multiple Wallets (Bulk)
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Wallet Label</th>
                      <th className="py-3 px-4 font-semibold">Address</th>
                      <th className="py-3 px-4 font-semibold">Format</th>
                      <th className="py-3 px-4 font-semibold">Groups</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {wallets.map((w) => (
                      <tr key={w.address} className="hover:bg-slate-850/50 transition">
                        <td className="py-3 px-4 font-medium text-white">{w.label || 'Unnamed'}</td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          <div className="flex items-center gap-2">
                            <span>{w.address}</span>
                            <button
                              onClick={() => handleCopy(w.address, w.address)}
                              className="text-slate-500 hover:text-slate-300"
                              title="Copy address"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-indigo-900 uppercase font-mono text-[10px]">
                            {w.chain_type}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {w.group_names && w.group_names.length > 0 ? (
                              w.group_names.map((gn, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px]"
                                >
                                  {gn}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-500 italic">No groups</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="text-emerald-400 flex items-center gap-1 font-medium">
                            <Check className="w-3.5 h-3.5" /> Active
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleDeleteWallet(w.address)}
                            className="p-1.5 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition"
                            title="Remove Wallet"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* GROUPS TAB */}
        {currentTab === 'groups' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <FolderTree className="w-5 h-5 text-amber-400" /> Wallet Groups ({groups.length})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Organize smart money collectors into groups (e.g., Alpha, Whales, Snipers).
                </p>
              </div>
              <button
                onClick={() => setShowAddGroupModal(true)}
                className="text-xs px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-1.5 transition self-start sm:self-auto shadow"
              >
                <Plus className="w-4 h-4" /> Create New Group
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {groups.map((g) => (
                <div key={g.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold text-base text-white flex items-center gap-2">
                        📁 {g.name}
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                        {g.wallet_count || 0} Wallets
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">{g.description || 'No description provided.'}</p>
                    <div className="text-[11px] font-mono text-slate-500 bg-slate-950 p-2 rounded border border-slate-850">
                      ID: {g.id}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                    <button
                      onClick={() => {
                        setBulkTargetGroupId(g.id);
                        setShowBulkAddModal(true);
                      }}
                      className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 flex items-center gap-1 transition"
                    >
                      <Layers className="w-3 h-3" /> Bulk Add
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">
                        {new Date(g.created_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleDeleteGroup(g.id, g.name)}
                        className="p-1.5 text-slate-500 hover:text-red-400 rounded hover:bg-slate-800 transition"
                        title="Delete Group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CHAINS TAB */}
        {currentTab === 'chains' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-400" /> Supported Blockchains & OpenSea API v2 Status
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Chains discovered dynamically from the official OpenSea API v2 endpoint (<code>GET https://api.opensea.io/api/v2/chains</code>).
                In compliance with requirements, only chains that fully support the OpenSea v2 account activity endpoints are marked actively monitored.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {chains.map((chain) => (
                <div key={chain.chain} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-white text-sm">{chain.name}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          chain.is_monitored
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {chain.is_monitored ? '🟢 Actively Monitored' : '⚪ Supported'}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 space-y-1 font-mono">
                      <div>Slug: <span className="text-amber-300">{chain.chain}</span></div>
                      <div>Type: <span className="text-indigo-300 uppercase">{chain.network_type}</span></div>
                    </div>
                    {chain.notes && (
                      <div className="text-[11px] text-slate-400 mt-2 bg-slate-950 p-2 rounded border border-slate-800">
                        {chain.notes}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-2.5 border-t border-slate-800 text-[11px] text-slate-500">
                    Endpoint: /events/accounts/{'{address}'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TESTS TAB */}
        {currentTab === 'tests' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Automated Test Runner (16 Automated Test Suites)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Verifies wallet/group management, bulk wallet operations, clearing wallets, genuine mint vs sale detection, ordinary transfer exclusion, and multi-group deduplication.
                </p>
              </div>
              <button
                onClick={handleRunTests}
                disabled={runningTests}
                className="text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition disabled:opacity-50 shadow"
              >
                <Play className="w-3.5 h-3.5" /> {runningTests ? 'Running Suites...' : 'Run All 16 Tests'}
              </button>
            </div>

            {testResults ? (
              <div className="space-y-4">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                        testResults.summary.failed === 0
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}
                    >
                      {testResults.summary.passed}/{testResults.summary.total}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">
                        {testResults.summary.failed === 0 ? 'All 14 Test Cases Passed!' : `${testResults.summary.failed} Test(s) Failed`}
                      </div>
                      <div className="text-xs text-slate-400">Zero regression detected in core logic.</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {testResults.results.map((r, i) => (
                    <div
                      key={i}
                      className={`p-3.5 rounded-xl border flex items-center justify-between ${
                        r.passed
                          ? 'bg-slate-900/80 border-slate-800 text-slate-200'
                          : 'bg-red-950/20 border-red-800 text-red-200'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {r.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                        )}
                        <div>
                          <div className="text-xs font-medium text-white">{r.title}</div>
                          {r.message && <div className="text-[11px] text-red-400 mt-0.5">{r.message}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 text-[10px]">{r.category}</span>
                        <span>{r.durationMs}ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white">Test Suites Ready</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1 mb-4">
                  Run the 14 automated verification tests for group management, activity detection, address validation, and deduplication.
                </p>
                <button
                  onClick={handleRunTests}
                  className="text-xs px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium"
                >
                  Execute 14 Test Suites Now
                </button>
              </div>
            )}
          </div>
        )}

        {/* BOTKEEP DEPLOY TAB */}
        {currentTab === 'deploy' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-slate-900 to-indigo-950/40 border border-slate-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <ShieldCheck className="w-6 h-6 text-indigo-400" />
                <h2 className="text-lg font-bold text-white">Botkeep Cloud Deployment Package</h2>
              </div>
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                This project is packaged and configured for 24/7 production deployment on Botkeep Cloud.
                Follow the checklist below to deploy with persistent disk storage.
              </p>
              <div className="mt-4 flex gap-3">
                <a
                  href="/api/download-zip"
                  download="telegram-nft-smart-money-bot.zip"
                  className="text-xs px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 transition shadow"
                >
                  <Download className="w-4 h-4" /> Download Complete Project ZIP
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Deployment Steps */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <h3 className="font-semibold text-white text-sm">Botkeep Cloud Deployment Steps</h3>
                <ol className="space-y-3 text-xs text-slate-300 list-decimal list-inside leading-relaxed">
                  <li>
                    <strong className="text-white">Create New Bot on Botkeep:</strong> Select Node.js 22 LTS runtime.
                  </li>
                  <li>
                    <strong className="text-white">Upload / Push Code:</strong> Connect your Git repository or extract <code>telegram-nft-smart-money-bot.zip</code>.
                  </li>
                  <li>
                    <strong className="text-white">Configure Persistent Volume:</strong> Mount a persistent volume at <code>/data</code> or <code>./data</code> so that <code>nft_bot.sqlite</code> persists across container restarts and redeployments.
                  </li>
                  <li>
                    <strong className="text-white">Set Environment Variables:</strong> Add the 4 required variables in the Botkeep dashboard.
                  </li>
                  <li>
                    <strong className="text-white">Set Production Start Command:</strong> <code>npm run start:bot</code> (for standalone Telegram polling) or <code>npm start</code> (for web dashboard + Telegram polling).
                  </li>
                </ol>
              </div>

              {/* Environment Variables Reference */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <h3 className="font-semibold text-white text-sm">Required Environment Variables</h3>
                <div className="space-y-2 text-xs font-mono">
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-amber-400 font-bold">TELEGRAM_BOT_TOKEN</div>
                    <div className="text-slate-400 text-[11px] font-sans mt-0.5">Your BotFather token.</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-amber-400 font-bold">TELEGRAM_ADMIN_IDS</div>
                    <div className="text-slate-400 text-[11px] font-sans mt-0.5">Comma-separated user IDs (e.g. 12345678,98765432).</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-amber-400 font-bold">OPENSEA_API_KEY</div>
                    <div className="text-slate-400 text-[11px] font-sans mt-0.5">Official OpenSea API v2 key for high rate limits.</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-amber-400 font-bold">DATABASE_PATH=./data/nft_bot.sqlite</div>
                    <div className="text-slate-400 text-[11px] font-sans mt-0.5">Path to persistent SQLite database file.</div>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <div className="text-amber-400 font-bold">POLL_INTERVAL_SECONDS=10</div>
                    <div className="text-slate-400 text-[11px] font-sans mt-0.5">Polling interval in seconds (default: 10s).</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Add Wallet Modal */}
      {showAddWalletModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1">Add Tracked Smart Money Wallet</h3>
            <p className="text-xs text-slate-400 mb-4">
              Enter EVM (0x...) or Solana (Base58) address. Address format is validated automatically.
            </p>

            {walletFormError && (
              <div className="mb-4 p-2.5 rounded bg-red-950/40 border border-red-800 text-xs text-red-300">
                {walletFormError}
              </div>
            )}

            <form onSubmit={handleAddWallet} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Wallet Address *</label>
                <input
                  type="text"
                  required
                  placeholder="0x... or Solana Base58 address"
                  value={newWalletAddress}
                  onChange={(e) => setNewWalletAddress(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Label / Trader Name</label>
                <input
                  type="text"
                  placeholder="e.g. vitalik.eth, Whale #1, Alpha Sniper"
                  value={newWalletLabel}
                  onChange={(e) => setNewWalletLabel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Blockchain Type</label>
                <select
                  value={newWalletChain}
                  onChange={(e: any) => setNewWalletChain(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                >
                  <option value="evm">EVM (Ethereum, Base, Polygon, Arbitrum, Optimism, Blast)</option>
                  <option value="solana">Solana (Base58)</option>
                  <option value="flow">Flow (EVM / Cadence)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Assign to Groups</label>
                <div className="space-y-1.5 max-h-32 overflow-y-auto bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(g.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGroupIds((prev) => [...prev, g.id]);
                          } else {
                            setSelectedGroupIds((prev) => prev.filter((id) => id !== g.id));
                          }
                        }}
                        className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0"
                      />
                      <span>📁 {g.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddWalletModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition"
                >
                  Add Wallet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Group Modal */}
      {showAddGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-1">Create Wallet Group</h3>
            <p className="text-xs text-slate-400 mb-4">
              Group smart money wallets together for consolidated mint & purchase activity alerts.
            </p>

            <form onSubmit={handleAddGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Group Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alpha, Whales, Early Snipers"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Description (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Brief note on what makes this group distinctive..."
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddGroupModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Add Wallets to Group Modal */}
      {showBulkAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">Bulk Add Wallets to Group</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Add multiple smart money addresses to a group at once. Paste addresses separated by lines, spaces, or commas. Optional labels can be placed next to each address.
            </p>

            {bulkResultMsg && (
              <div
                className={`mb-4 p-3 rounded-lg text-xs ${
                  bulkResultMsg.type === 'success'
                    ? 'bg-emerald-950/40 border border-emerald-800 text-emerald-300'
                    : 'bg-red-950/40 border border-red-800 text-red-300'
                }`}
              >
                {bulkResultMsg.text}
              </div>
            )}

            <form onSubmit={handleBulkAdd} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Target Group *</label>
                <div className="flex gap-2">
                  <select
                    value={bulkTargetGroupId}
                    onChange={(e) => setBulkTargetGroupId(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                  >
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        📁 {g.name} ({g.wallet_count || 0} wallets)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">Wallet Addresses *</label>
                  <span className="text-[10px] text-slate-500 font-mono">EVM (0x...) or Solana (Base58)</span>
                </div>
                <textarea
                  rows={6}
                  required
                  placeholder={`0x1111111111111111111111111111111111111111 Whale 1\n0x2222222222222222222222222222222222222222 Sniper 2\n7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU Solana Whale`}
                  value={bulkRawInput}
                  onChange={(e) => setBulkRawInput(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-slate-400">
                  {bulkRawInput.trim().split(/\n+/).filter(Boolean).length} address line(s) entered
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowBulkAddModal(false);
                      setBulkResultMsg(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-800 transition"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={bulkLoading}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition disabled:opacity-50"
                  >
                    {bulkLoading ? 'Adding...' : 'Import Wallets'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
