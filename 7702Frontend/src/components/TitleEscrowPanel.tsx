import { useState, useEffect } from "react";
import { createWalletClient, createPublicClient, custom, http, parseAbi, parseEventLogs, isAddress, toHex, encodeFunctionData } from "viem";
import { sepolia } from "viem/chains";
import { TITLE_ESCROW_ADDRESS, SEPOLIA_RPC_URL } from "../lib/constants";
import { buildSmartAccountClient } from "../lib/pimlico";

const PERMANENT_OWNER = "0x433097a1C1b8a3e9188d8C54eCC057B1D69f1638".toLowerCase();
const LS_KEY = "trustvc_title_escrow";

const paymasterAbi = parseAbi([
  "function mintDocument(address registry, address beneficiary, address holder, uint256 tokenId, bytes remark) external returns (address titleEscrow)",
  "event TitleEscrowLinked(address indexed titleEscrow, address indexed registry)",
]);

interface Props {
  address: string | null;
  isDelegated: boolean;
  paymasterAddress: string | null;
  registryAddress: string | null;
  onTitleEscrowReady: (address: `0x${string}`) => void;
}

type Mode = "mint" | "load";

export function TitleEscrowPanel({ address, isDelegated, paymasterAddress, registryAddress, onTitleEscrowReady }: Props) {
  const envEscrow = TITLE_ESCROW_ADDRESS && TITLE_ESCROW_ADDRESS !== "0x" ? TITLE_ESCROW_ADDRESS : null;

  const [mode, setMode] = useState<Mode>("mint");
  const [activeTitleEscrow, setActiveTitleEscrow] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [beneficiary, setBeneficiary] = useState("");
  const [holder, setHolder] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [remark, setRemark] = useState("");
  const [loadInput, setLoadInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [justMinted, setJustMinted] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);

  useEffect(() => {
    if (!address) { setActiveTitleEscrow(null); return; }
    if (address.toLowerCase() === PERMANENT_OWNER && envEscrow) {
      setActiveTitleEscrow(envEscrow);
      onTitleEscrowReady(envEscrow);
      return;
    }
    const saved = localStorage.getItem(LS_KEY);
    if (saved) { setActiveTitleEscrow(saved); onTitleEscrowReady(saved as `0x${string}`); }
    else setActiveTitleEscrow(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const isPermanentOwner = address?.toLowerCase() === PERMANENT_OWNER;
  const disabled = !address || !paymasterAddress || !registryAddress;

  function randomTokenId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return BigInt("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")).toString();
  }

  function handleLoad() {
    setLoadError(null);
    const trimmed = loadInput.trim();
    if (!isAddress(trimmed)) { setLoadError("Invalid address."); return; }
    localStorage.setItem(LS_KEY, trimmed);
    setActiveTitleEscrow(trimmed);
    setJustLoaded(true);
    onTitleEscrowReady(trimmed as `0x${string}`);
  }

  async function handleMint() {
    if (!address || !paymasterAddress || !registryAddress) return;
    if (!isAddress(beneficiary)) { setMintError("Invalid beneficiary address."); return; }
    if (!isAddress(holder)) { setMintError("Invalid holder address."); return; }
    setMintError(null);
    setMinting(true);
    try {
      const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
      const tid = tokenId.trim() ? BigInt(tokenId.trim()) : BigInt("0x" +
        Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join(""));
      const remarkBytes: `0x${string}` = remark.trim() ? toHex(remark.trim()) : "0x";

      const calldata = encodeFunctionData({
        abi: paymasterAbi,
        functionName: "mintDocument",
        args: [registryAddress as `0x${string}`, beneficiary as `0x${string}`, holder as `0x${string}`, tid, remarkBytes],
      });

      let txHash: `0x${string}`;
      if (isDelegated) {
        const { smartAccountClient } = await buildSmartAccountClient(
          address as `0x${string}`,
          paymasterAddress as `0x${string}`,
        );
        txHash = await smartAccountClient.sendTransaction({
          to: paymasterAddress as `0x${string}`,
          value: 0n,
          data: calldata,
        }) as `0x${string}`;
      } else {
        const walletClient = createWalletClient({
          account: address as `0x${string}`,
          chain: sepolia,
          transport: custom(window.ethereum),
        });
        txHash = await walletClient.sendTransaction({
          to: paymasterAddress as `0x${string}`,
          value: 0n,
          data: calldata,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      const logs = parseEventLogs({ abi: paymasterAbi, logs: receipt.logs, eventName: "TitleEscrowLinked" });
      const escrowAddr = logs[0]?.args?.titleEscrow;
      if (!escrowAddr) throw new Error("Mint succeeded but TitleEscrow address not found in logs");

      localStorage.setItem(LS_KEY, escrowAddr);
      setActiveTitleEscrow(escrowAddr);
      setJustMinted(true);
      onTitleEscrowReady(escrowAddr);
    } catch (e: unknown) {
      setMintError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }

  if (activeTitleEscrow) {
    return (
      <div className="panel">
        <div className="flex items-center justify-between mb-3">
          <p className="panel-title mb-0">Title Escrow</p>
          <span className="badge-green">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            {justMinted ? "Minted" : "Active"}
          </span>
        </div>
        <div className="space-y-1.5 text-xs text-gray-400">
          <div className="flex gap-2">
            <span className="text-gray-600 w-28 shrink-0">Title Escrow:</span>
            <a
              href={`https://sepolia.etherscan.io/address/${activeTitleEscrow}`}
              target="_blank" rel="noreferrer"
              className="font-mono text-indigo-300 hover:text-indigo-200 break-all"
            >
              {activeTitleEscrow}
            </a>
          </div>
          {isPermanentOwner && (
            <p className="text-xs text-gray-600">Loaded from environment (permanent owner).</p>
          )}
          {justMinted && (
            <p className="text-emerald-400 pt-1">
              Minted and saved to local storage.
            </p>
          )}
          {justLoaded && <p className="text-emerald-400 pt-1">Title escrow loaded.</p>}
        </div>
        {!isPermanentOwner && (
          <button
            className="text-xs text-gray-600 hover:text-gray-400 mt-3"
            onClick={() => { localStorage.removeItem(LS_KEY); setActiveTitleEscrow(null); setJustMinted(false); setJustLoaded(false); setLoadInput(""); }}
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
        <p className="panel-title mb-0">Title Escrow</p>
        <span className="badge-yellow">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          Not set
        </span>
      </div>

      {!registryAddress && (
        <p className="text-xs text-yellow-400 mb-3">Set up a registry first.</p>
      )}

      <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1">
        <button
          onClick={() => { setMode("mint"); setMintError(null); }}
          className={`flex-1 text-xs py-1.5 rounded-md transition-all ${mode === "mint" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-300"}`}
        >
          Mint Document
        </button>
        <button
          onClick={() => { setMode("load"); setLoadError(null); }}
          className={`flex-1 text-xs py-1.5 rounded-md transition-all ${mode === "load" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-gray-300"}`}
        >
          Use Existing
        </button>
      </div>

      {mode === "mint" ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Mint a new trade document. This deploys a TitleEscrow and assigns the initial beneficiary and holder.
          </p>
          <input className="input w-full" placeholder="Beneficiary address (0x...)" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} disabled={disabled || minting} />
          <input className="input w-full" placeholder="Holder address (0x...)" value={holder} onChange={(e) => setHolder(e.target.value)} disabled={disabled || minting} />
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Token ID (leave blank to auto-generate)" value={tokenId} onChange={(e) => setTokenId(e.target.value)} disabled={disabled || minting} />
            <button
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:border-indigo-600 hover:text-indigo-400 transition-all shrink-0"
              onClick={() => setTokenId(randomTokenId())}
              disabled={disabled || minting}
            >
              Random
            </button>
          </div>
          <input className="input w-full" placeholder="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} disabled={disabled || minting} />

          <div className="text-xs text-gray-600 space-y-0.5">
            <div className="flex gap-2">
              <span className="w-20 shrink-0">Registry:</span>
              <span className="font-mono">{registryAddress ?? "—"}</span>
            </div>
          </div>

          <button className="btn-primary w-full" onClick={handleMint} disabled={disabled || minting}>
            {minting ? "Minting..." : isDelegated ? "Mint Document (gasless)" : "Mint Document"}
          </button>
          {mintError && <p className="text-xs text-red-400 break-all">{mintError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Already have a title escrow? Paste the address — it will be saved in your browser.</p>
          <input className="input w-full" placeholder="0x... title escrow address" value={loadInput} onChange={(e) => { setLoadInput(e.target.value); setLoadError(null); }} disabled={disabled} />
          <button className="btn-primary w-full" onClick={handleLoad} disabled={disabled || !loadInput.trim()}>
            Load Title Escrow
          </button>
          {loadError && <p className="text-xs text-red-400">{loadError}</p>}
        </div>
      )}
    </div>
  );
}
