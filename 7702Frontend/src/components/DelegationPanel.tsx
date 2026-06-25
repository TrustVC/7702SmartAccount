import { useState, useEffect, useCallback } from "react";
import { checkDelegation, PERMISSIONLESS_IMPL } from "../lib/pimlico";

interface Props {
  address: string | null;
  onDelegated: (delegated: boolean) => void;
}

export function DelegationPanel({ address, onDelegated }: Props) {
  const [currentDelegate, setCurrentDelegate] = useState<
    string | null | undefined
  >(undefined);
  const [checking, setChecking] = useState(false);

  const isDelegated =
    currentDelegate?.toLowerCase() === PERMISSIONLESS_IMPL.toLowerCase();

  const refresh = useCallback(async () => {
    if (!address) return;
    setChecking(true);
    try {
      const delegate = await checkDelegation(address as `0x${string}`);
      setCurrentDelegate(delegate);
      onDelegated(
        delegate?.toLowerCase() === PERMISSIONLESS_IMPL.toLowerCase(),
      );
    } finally {
      setChecking(false);
    }
  }, [address, onDelegated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!address) {
    return (
      <div className="panel opacity-50">
        <p className="panel-title">EIP-7702 Delegation</p>
        <p className="text-sm text-gray-500">Connect wallet first</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-3">
        <p className="panel-title mb-0">EIP-7702 Delegation</p>
        {checking ? (
          <span className="text-xs text-gray-500 animate-pulse">
            checking...
          </span>
        ) : currentDelegate === undefined ? null : isDelegated ? (
          <span className="badge-green">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            Active
          </span>
        ) : (
          <span className="badge-yellow">
            <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
            Pending
          </span>
        )}
      </div>

      <div className="space-y-1.5 text-xs text-gray-400 mb-4">
        <div className="flex gap-2">
          <span className="text-gray-600 w-32 shrink-0">Target impl:</span>
          <span className="text-indigo-300 break-all font-mono">
            {PERMISSIONLESS_IMPL}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-600 w-32 shrink-0">Current delegate:</span>
          <span
            className={`break-all font-mono ${isDelegated ? "text-emerald-300" : "text-gray-500"}`}
          >
            {currentDelegate === undefined ? "—" : (currentDelegate ?? "none")}
          </span>
        </div>
      </div>

      {isDelegated ? (
        <p className="text-xs text-emerald-400">
          Your EOA is delegated to the implementation contract above. All
          transactions are sent as smart account UserOps.
        </p>
      ) : (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3 text-xs text-gray-300">
          <p className="font-medium text-yellow-300 mb-1">Not delegated</p>
          <p className="text-gray-400 mb-2">
            Your EOA has not been delegated yet. To delegate, run the following
            command in the CLI:
          </p>
          <pre className="bg-black/40 rounded px-2 py-1.5 font-mono text-yellow-200 select-all">
            npx ts-node scripts/trFunctions/delegate.ts
          </pre>
        </div>
      )}

      <button
        className="text-xs text-indigo-400 hover:text-indigo-300 mt-3"
        onClick={refresh}
        disabled={checking}
      >
        Refresh
      </button>
    </div>
  );
}
