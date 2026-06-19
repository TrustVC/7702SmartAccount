import { useState, useEffect, useCallback } from "react";
import { checkDelegation, PERMISSIONLESS_IMPL } from "../lib/pimlico";

interface Props {
  address: string | null;
  onDelegated: (delegated: boolean) => void;
}

export function DelegationPanel({ address, onDelegated }: Props) {
  const [currentDelegate, setCurrentDelegate] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const isDelegated =
    currentDelegate?.toLowerCase() === PERMISSIONLESS_IMPL.toLowerCase();

  const refresh = useCallback(async () => {
    if (!address) return;
    setChecking(true);
    try {
      const delegate = await checkDelegation(address as `0x${string}`);
      setCurrentDelegate(delegate);
      onDelegated(delegate?.toLowerCase() === PERMISSIONLESS_IMPL.toLowerCase());
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
          <span className="text-xs text-gray-500 animate-pulse">checking...</span>
        ) : isDelegated ? (
          <span className="badge-green">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            Delegated
          </span>
        ) : (
          <span className="badge-yellow">
            <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
            Not Delegated
          </span>
        )}
      </div>

      <div className="space-y-1.5 text-xs text-gray-400 mb-3">
        <div className="flex gap-2">
          <span className="text-gray-600 w-32 shrink-0">Expected (permissionless):</span>
          <span className="text-indigo-300 break-all">{PERMISSIONLESS_IMPL}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-gray-600 w-32 shrink-0">Current delegate:</span>
          <span className={isDelegated ? "text-emerald-300 break-all" : "text-gray-500"}>
            {currentDelegate ?? "none"}
          </span>
        </div>
      </div>

      {!isDelegated && (
        <p className="text-xs text-yellow-400">
          Delegation will happen automatically when you send the first UserOp.
          permissionless includes the EIP-7702 authorization in the first transaction.
        </p>
      )}

      <button
        className="text-xs text-indigo-400 hover:text-indigo-300 mt-2"
        onClick={refresh}
      >
        Refresh
      </button>
    </div>
  );
}
