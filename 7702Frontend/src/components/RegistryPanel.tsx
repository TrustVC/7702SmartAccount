import { useState, useEffect } from "react";
import {
  createPublicClient,
  http,
  parseAbi,
  parseEventLogs,
  isAddress,
  encodeFunctionData,
} from "viem";
import { sepolia } from "viem/chains";
import {
  REGISTRY_ADDRESS,
  SEPOLIA_RPC_URL,
  TDOC_IMPLEMENTATION,
} from "../lib/constants";
import { buildSmartAccountClient } from "../lib/pimlico";

const PERMANENT_OWNER =
  "0x433097a1C1b8a3e9188d8C54eCC057B1D69f1638".toLowerCase();
const LS_KEY = "trustvc_registry";

const paymasterAbi = parseAbi([
  "function deployRegistry(address implementation, string name, string symbol) external returns (address deployed)",
  "event RegistryDeployed(address indexed user, address indexed deployed, uint256 creditsLeft)",
]);

interface Props {
  address: string | null;
  paymasterAddress: string | null;
  isDelegated: boolean;
  onRegistryReady: (address: `0x${string}`) => void;
}

type Mode = "deploy" | "load";

export function RegistryPanel({
  address,
  paymasterAddress,
  isDelegated,
  onRegistryReady,
}: Props) {
  const envRegistry =
    REGISTRY_ADDRESS && REGISTRY_ADDRESS !== "0x" ? REGISTRY_ADDRESS : null;

  const [mode, setMode] = useState<Mode>("deploy");
  const [activeRegistry, setActiveRegistry] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [implAddress, setImplAddress] = useState<string>(
    TDOC_IMPLEMENTATION ?? "",
  );
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [loadInput, setLoadInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [justDeployed, setJustDeployed] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);

  useEffect(() => {
    if (!address) {
      setActiveRegistry(null);
      return;
    }
    if (address.toLowerCase() === PERMANENT_OWNER && envRegistry) {
      setActiveRegistry(envRegistry);
      onRegistryReady(envRegistry);
      return;
    }
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      setActiveRegistry(saved);
      onRegistryReady(saved as `0x${string}`);
    } else setActiveRegistry(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const isPermanentOwner = address?.toLowerCase() === PERMANENT_OWNER;
  const disabled = !address || !paymasterAddress;

  function handleLoad() {
    setLoadError(null);
    const trimmed = loadInput.trim();
    if (!isAddress(trimmed)) {
      setLoadError("Invalid address.");
      return;
    }
    localStorage.setItem(LS_KEY, trimmed);
    setActiveRegistry(trimmed);
    setJustLoaded(true);
    onRegistryReady(trimmed as `0x${string}`);
  }

  async function handleDeploy() {
    if (!address || !paymasterAddress) return;
    if (!isAddress(implAddress)) {
      setDeployError("Invalid implementation address.");
      return;
    }
    if (!tokenName.trim()) {
      setDeployError("Token name is required.");
      return;
    }
    if (!tokenSymbol.trim()) {
      setDeployError("Token symbol is required.");
      return;
    }
    setDeployError(null);
    setDeploying(true);
    try {
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(SEPOLIA_RPC_URL),
      });
      const calldata = encodeFunctionData({
        abi: paymasterAbi,
        functionName: "deployRegistry",
        args: [
          implAddress as `0x${string}`,
          tokenName.trim(),
          tokenSymbol.trim(),
        ],
      });

      let txHash: `0x${string}`;
      if (isDelegated) {
        const { smartAccountClient } = await buildSmartAccountClient(
          address as `0x${string}`,
          paymasterAddress as `0x${string}`,
        );
        txHash = (await smartAccountClient.sendTransaction({
          to: paymasterAddress as `0x${string}`,
          value: 0n,
          data: calldata,
        })) as `0x${string}`;
      } else {
        throw new Error(
          "Delegation required for gasless registry deploy. Run the delegate script first or delegate via DelegationPanel.",
        );
      }

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      const logs = parseEventLogs({
        abi: paymasterAbi,
        logs: receipt.logs,
        eventName: "RegistryDeployed",
      });
      const registryAddr = logs[0]?.args?.deployed;
      if (!registryAddr)
        throw new Error(
          "Deploy succeeded but registry address not found in logs",
        );

      localStorage.setItem(LS_KEY, registryAddr);
      setActiveRegistry(registryAddr);
      setJustDeployed(true);
      onRegistryReady(registryAddr);
    } catch (e: unknown) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  }

  if (activeRegistry) {
    return (
      <div className="panel">
        <div className="flex items-center justify-between mb-3">
          <p className="panel-title mb-0">Token Registry</p>
          <span className="badge-green">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            {justDeployed ? "Deployed" : "Active"}
          </span>
        </div>
        <div className="space-y-1.5 text-xs text-gray-400">
          <div className="flex gap-2">
            <span className="text-gray-600 w-24 shrink-0">Registry:</span>
            <a
              href={`https://sepolia.etherscan.io/address/${activeRegistry}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-indigo-300 hover:text-indigo-200 break-all"
            >
              {activeRegistry}
            </a>
          </div>
          {isPermanentOwner && (
            <p className="text-xs text-gray-600">
              Loaded from environment (permanent owner).
            </p>
          )}
          {justDeployed && (
            <p className="text-emerald-400 pt-1">
              Deployed and saved to local storage.
            </p>
          )}
          {justLoaded && (
            <p className="text-emerald-400 pt-1">Registry loaded.</p>
          )}
        </div>
        {!isPermanentOwner && (
          <button
            className="text-xs text-gray-600 hover:text-gray-400 mt-3"
            onClick={() => {
              localStorage.removeItem(LS_KEY);
              setActiveRegistry(null);
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
        <p className="panel-title mb-0">Token Registry</p>
        <span className="badge-yellow">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          Not set
        </span>
      </div>

      {!paymasterAddress && (
        <p className="text-xs text-yellow-400 mb-3">
          Set up a paymaster first.
        </p>
      )}

      <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1">
        <button
          onClick={() => {
            setMode("deploy");
            setDeployError(null);
          }}
          className={`flex-1 text-xs py-1.5 rounded-md transition-all ${mode === "deploy" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-300"}`}
        >
          Deploy New
        </button>
        <button
          onClick={() => {
            setMode("load");
            setLoadError(null);
          }}
          className={`flex-1 text-xs py-1.5 rounded-md transition-all ${mode === "load" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-300"}`}
        >
          Use Existing
        </button>
      </div>

      {mode === "deploy" ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Deploy a new TDoc registry via the paymaster. Requires whitelist
            credits on the paymaster.
          </p>
          <input
            className="input w-full"
            placeholder="Implementation address (0x...)"
            value={implAddress}
            onChange={(e) => setImplAddress(e.target.value)}
            disabled={disabled || deploying}
          />
          <input
            className="input w-full"
            placeholder="Token name (e.g. Trade Trust)"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            disabled={disabled || deploying}
          />
          <input
            className="input w-full"
            placeholder="Token symbol (e.g. TTOC)"
            value={tokenSymbol}
            onChange={(e) => setTokenSymbol(e.target.value)}
            disabled={disabled || deploying}
          />
          <button
            className="btn-primary w-full"
            onClick={handleDeploy}
            disabled={disabled || deploying || !isDelegated}
          >
            {deploying
              ? "Deploying..."
              : isDelegated
                ? "Deploy Registry (gasless)"
                : "Delegate first to deploy"}
          </button>
          {!isDelegated && !disabled && (
            <p className="text-xs text-yellow-400">
              Delegation required — run{" "}
              <span className="font-mono">
                npx ts-node scripts/trFunctions/delegate.ts
              </span>{" "}
              first.
            </p>
          )}
          {deployError && (
            <p className="text-xs text-red-400 break-all">{deployError}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Already have a registry? Paste the address — it will be saved in
            your browser.
          </p>
          <input
            className="input w-full"
            placeholder="0x... registry address"
            value={loadInput}
            onChange={(e) => {
              setLoadInput(e.target.value);
              setLoadError(null);
            }}
            disabled={disabled}
          />
          <button
            className="btn-primary w-full"
            onClick={handleLoad}
            disabled={disabled || !loadInput.trim()}
          >
            Load Registry
          </button>
          {loadError && <p className="text-xs text-red-400">{loadError}</p>}
        </div>
      )}
    </div>
  );
}
