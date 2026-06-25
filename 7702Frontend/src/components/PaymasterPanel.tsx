import { useState, useEffect } from "react";
import { createWalletClient, createPublicClient, custom, http, parseAbi, parseEventLogs, parseEther, isAddress } from "viem";
import { sepolia } from "viem/chains";
import { PAYMASTER_ADDRESS, FACTORY_ADDRESS, SEPOLIA_RPC_URL } from "../lib/constants";
const PERMANENT_OWNER = "0x433097a1C1b8a3e9188d8C54eCC057B1D69f1638".toLowerCase();
const LS_KEY = "trustvc_paymaster";

const factoryAbi = parseAbi([
  "function deployPlatformPaymaster(address platformAddress, uint256 dailyLimit, bytes32 salt) external returns (address paymaster)",
  "event PlatformOnboarded(address indexed platformAddress, address indexed paymaster)",
]);

interface Props {
  address: string | null;
  onPaymasterDeployed: (address: `0x${string}`) => void;
}

type Mode = "deploy" | "load";

export function PaymasterPanel({ address, onPaymasterDeployed }: Props) {
  const envPaymaster = PAYMASTER_ADDRESS && PAYMASTER_ADDRESS !== "0x" ? PAYMASTER_ADDRESS : null;

  const [mode, setMode] = useState<Mode>("deploy");
  const [activePaymaster, setActivePaymaster] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [dailyLimitEth, setDailyLimitEth] = useState("0");
  const [loadInput, setLoadInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [justDeployed, setJustDeployed] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);

  // When address changes, resolve which paymaster to use
  useEffect(() => {
    if (!address) {
      setActivePaymaster(null);
      return;
    }

    // Permanent owner → always use env paymaster
    if (address.toLowerCase() === PERMANENT_OWNER && envPaymaster) {
      setActivePaymaster(envPaymaster);
      onPaymasterDeployed(envPaymaster);
      return;
    }

    // Anyone else → check localStorage
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      setActivePaymaster(saved);
      onPaymasterDeployed(saved as `0x${string}`);
    } else {
      setActivePaymaster(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const isPermanentOwner = address?.toLowerCase() === PERMANENT_OWNER;
  const disabled = !address;

  function handleLoad() {
    setLoadError(null);
    const trimmed = loadInput.trim();
    if (!isAddress(trimmed)) {
      setLoadError("Invalid address.");
      return;
    }
    localStorage.setItem(LS_KEY, trimmed);
    setActivePaymaster(trimmed);
    setJustLoaded(true);
    onPaymasterDeployed(trimmed as `0x${string}`);
  }

  async function handleDeploy() {
    if (!address) return;
    setDeployError(null);
    setDeploying(true);
    try {
      const transport = http(SEPOLIA_RPC_URL);
      const publicClient = createPublicClient({ chain: sepolia, transport });
      const walletClient = createWalletClient({
        account: address as `0x${string}`,
        chain: sepolia,
        transport: custom(window.ethereum),
      });

      const salt = ("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")) as `0x${string}`;

      const dailyLimit = dailyLimitEth && parseFloat(dailyLimitEth) > 0
        ? parseEther(dailyLimitEth)
        : 0n;

      const txHash = await walletClient.writeContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: "deployPlatformPaymaster",
        args: [address as `0x${string}`, dailyLimit, salt],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const logs = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: "PlatformOnboarded" });
      const paymasterAddr = logs[0]?.args?.paymaster;
      if (!paymasterAddr) throw new Error("Deploy succeeded but paymaster address not found in logs");

      localStorage.setItem(LS_KEY, paymasterAddr);
      setActivePaymaster(paymasterAddr);
      setJustDeployed(true);
      onPaymasterDeployed(paymasterAddr);
    } catch (e: unknown) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  }

  // Active state
  if (activePaymaster) {
    return (
      <div className="panel">
        <div className="flex items-center justify-between mb-3">
          <p className="panel-title mb-0">Platform Paymaster</p>
          <span className="badge-green">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            {justDeployed ? "Deployed" : "Active"}
          </span>
        </div>

        <div className="space-y-1.5 text-xs text-gray-400">
          <div className="flex gap-2">
            <span className="text-gray-600 w-24 shrink-0">Paymaster:</span>
            <a
              href={`https://sepolia.etherscan.io/address/${activePaymaster}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-indigo-300 hover:text-indigo-200 break-all"
            >
              {activePaymaster}
            </a>
          </div>
          {isPermanentOwner && (
            <p className="text-xs text-gray-600">Loaded from environment (permanent owner).</p>
          )}
          {justDeployed && (
            <p className="text-emerald-400 pt-1">Deployed and saved to local storage.</p>
          )}
          {justLoaded && (
            <p className="text-emerald-400 pt-1">Paymaster loaded and saved for this browser.</p>
          )}
        </div>

        {!isPermanentOwner && (
          <button
            className="text-xs text-gray-600 hover:text-gray-400 mt-3"
            onClick={() => {
              localStorage.removeItem(LS_KEY);
              setActivePaymaster(null);
              setJustDeployed(false);
              setJustLoaded(false);
              setLoadInput("");
            }}
          >
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`panel ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="panel-title mb-0">Platform Paymaster</p>
        <span className="badge-yellow">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          Not set
        </span>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1">
        <button
          onClick={() => { setMode("deploy"); setDeployError(null); }}
          className={`flex-1 text-xs py-1.5 rounded-md transition-all ${
            mode === "deploy" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Deploy New
        </button>
        <button
          onClick={() => { setMode("load"); setLoadError(null); }}
          className={`flex-1 text-xs py-1.5 rounded-md transition-all ${
            mode === "load" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-300"
          }`}
        >
          Use Existing
        </button>
      </div>

      {mode === "deploy" ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Deploy a <span className="text-white font-medium">PlatformPaymaster</span> via the factory. Your connected wallet becomes the paymaster owner.
          </p>

          <div className="flex gap-2 items-center">
            <label className="text-xs text-gray-500 w-32 shrink-0">Daily limit (ETH)</label>
            <input
              className="input flex-1"
              placeholder="0 = unlimited"
              value={dailyLimitEth}
              onChange={(e) => setDailyLimitEth(e.target.value)}
              disabled={disabled || deploying}
            />
          </div>

          <div className="text-xs text-gray-500 space-y-0.5">
            <div className="flex gap-2">
              <span className="w-32 shrink-0 text-gray-600">Platform owner:</span>
              <span className="font-mono">{address ?? "—"}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-32 shrink-0 text-gray-600">Factory:</span>
              <span className="font-mono text-gray-600">{FACTORY_ADDRESS}</span>
            </div>
          </div>

          <button
            className="btn-primary w-full"
            onClick={handleDeploy}
            disabled={disabled || deploying}
          >
            {deploying ? "Deploying..." : "Deploy Paymaster"}
          </button>

          {deployError && (
            <p className="text-xs text-red-400 break-all">{deployError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Already have a deployed paymaster? Paste the address below — it will be saved in your browser.
          </p>

          <input
            className="input w-full"
            placeholder="0x... paymaster address"
            value={loadInput}
            onChange={(e) => { setLoadInput(e.target.value); setLoadError(null); }}
            disabled={disabled}
          />

          <button
            className="btn-primary w-full"
            onClick={handleLoad}
            disabled={disabled || !loadInput.trim()}
          >
            Load Paymaster
          </button>

          {loadError && (
            <p className="text-xs text-red-400">{loadError}</p>
          )}
        </div>
      )}
    </div>
  );
}
