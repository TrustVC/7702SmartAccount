import { useState, useEffect, useCallback } from "react";
import { encodeFunctionData, createPublicClient, createWalletClient, custom, http, keccak256, toBytes } from "viem";
import { sepolia } from "viem/chains";
import { buildSmartAccountClient, toRemarkBytes, getPublicClient } from "../lib/pimlico";
import { SEPOLIA_RPC_URL } from "../lib/constants";
import { TITLE_ESCROW_ABI, REGISTRY_ABI } from "../lib/abis";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const MINTER_ROLE = keccak256(toBytes("MINTER_ROLE"));

type Action =
  | "nominate"
  | "transferBeneficiary"
  | "transferHolder"
  | "transferOwners"
  | "rejectBeneficiary"
  | "rejectHolder"
  | "rejectOwners"
  | "returnToIssuer"
  | "shred";

interface EscrowState {
  beneficiary: string;
  holder: string;
  nominee: string;
  prevBeneficiary: string;
  prevHolder: string;
  isHoldingToken: boolean;
  isAcceptor: boolean;
}

interface Props {
  address: string | null;
  isDelegated: boolean;
  paymasterAddress: string | null;
  titleEscrowAddress: string | null;
  registryAddress: string | null;
}

const ACTION_LABELS: Record<Action, string> = {
  nominate: "Nominate",
  transferBeneficiary: "Transfer Beneficiary",
  transferHolder: "Transfer Holder",
  transferOwners: "Transfer Owners",
  rejectBeneficiary: "Reject (Beneficiary)",
  rejectHolder: "Reject (Holder)",
  rejectOwners: "Reject (Owners)",
  returnToIssuer: "Return to Issuer",
  shred: "Shred Document",
};

const ADDRESS_ACTIONS: Action[] = ["nominate", "transferBeneficiary", "transferHolder"];
const DUAL_ADDRESS_ACTIONS: Action[] = ["transferOwners"];
const REMARK_ONLY_ACTIONS: Action[] = ["rejectBeneficiary", "rejectHolder", "rejectOwners", "returnToIssuer", "shred"];

function computeAvailableActions(
  escrow: EscrowState | null,
  account: string | null,
): Action[] {
  if (!escrow || !account) return [];

  const addr = account.toLowerCase();
  const isReturnedToIssuer = !escrow.isHoldingToken;
  const isActiveTitleEscrow = !isReturnedToIssuer;
  const isHolder = addr === escrow.holder.toLowerCase();
  const isBeneficiary = addr === escrow.beneficiary.toLowerCase();
  const isHolderAndBeneficiary = isHolder && isBeneficiary;
  const hasNominee = !!escrow.nominee && escrow.nominee !== ZERO_ADDR;
  const hasPrevBeneficiary = !!escrow.prevBeneficiary && escrow.prevBeneficiary !== ZERO_ADDR;
  const hasPrevHolder = !!escrow.prevHolder && escrow.prevHolder !== ZERO_ADDR;

  const available: Action[] = [];

  // nominate: beneficiary-only (not holder+beneficiary) nominates a new beneficiary
  if (isActiveTitleEscrow && isBeneficiary && !isHolder)
    available.push("nominate");

  // transferBeneficiary: holder+beneficiary direct transfer, OR holder endorsing a nominee
  if (isActiveTitleEscrow && (isHolderAndBeneficiary || (isHolder && hasNominee)))
    available.push("transferBeneficiary");

  // transferHolder
  if (isActiveTitleEscrow && isHolder)
    available.push("transferHolder");

  // transferOwners
  if (isActiveTitleEscrow && isHolder && isBeneficiary)
    available.push("transferOwners");

  // rejectBeneficiary: beneficiary-only, has a previous beneficiary to revert to
  if (!isHolderAndBeneficiary && isActiveTitleEscrow && isBeneficiary && hasPrevBeneficiary && !(isHolder && hasPrevHolder))
    available.push("rejectBeneficiary");

  // rejectHolder: holder-only, has a previous holder to revert to
  if (!isHolderAndBeneficiary && isActiveTitleEscrow && isHolder && hasPrevHolder && !(isBeneficiary && hasPrevBeneficiary))
    available.push("rejectHolder");

  // rejectOwners: both holder+beneficiary, both have previous values
  if (isActiveTitleEscrow && isHolderAndBeneficiary && hasPrevHolder && hasPrevBeneficiary)
    available.push("rejectOwners");

  // returnToIssuer: holder+beneficiary surrenders
  if (isActiveTitleEscrow && isHolder && isBeneficiary)
    available.push("returnToIssuer");

  // shred: only acceptor (minter role on registry) after surrender
  if (!isActiveTitleEscrow && isReturnedToIssuer && escrow.isAcceptor)
    available.push("shred");

  return available;
}

export function TrustVCPanel({ address, isDelegated, paymasterAddress, titleEscrowAddress, registryAddress }: Props) {
  const TITLE_ESCROW_ADDRESS = (titleEscrowAddress ?? "") as `0x${string}`;
  const [escrowState, setEscrowState] = useState<EscrowState | null>(null);
  const [activeAction, setActiveAction] = useState<Action | null>(null);
  const [targetAddress, setTargetAddress] = useState("");
  const [secondAddress, setSecondAddress] = useState("");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastTx, setLastTx] = useState<{ hash: string; gasless: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchEscrowState = useCallback(async () => {
    if (!titleEscrowAddress) return;
    try {
      const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
      const [beneficiary, holder, nominee, isHoldingToken, prevBeneficiary, prevHolder] = await Promise.all([
        publicClient.readContract({ address: TITLE_ESCROW_ADDRESS, abi: TITLE_ESCROW_ABI, functionName: "beneficiary" }),
        publicClient.readContract({ address: TITLE_ESCROW_ADDRESS, abi: TITLE_ESCROW_ABI, functionName: "holder" }),
        publicClient.readContract({ address: TITLE_ESCROW_ADDRESS, abi: TITLE_ESCROW_ABI, functionName: "nominee" }),
        publicClient.readContract({ address: TITLE_ESCROW_ADDRESS, abi: TITLE_ESCROW_ABI, functionName: "isHoldingToken" }),
        publicClient.readContract({ address: TITLE_ESCROW_ADDRESS, abi: TITLE_ESCROW_ABI, functionName: "prevBeneficiary" }),
        publicClient.readContract({ address: TITLE_ESCROW_ADDRESS, abi: TITLE_ESCROW_ABI, functionName: "prevHolder" }),
      ]);

      // Check if connected address has MINTER_ROLE on the registry (for shred/restore)
      let isAcceptor = false;
      if (address && registryAddress) {
        try {
          isAcceptor = await publicClient.readContract({
            address: registryAddress as `0x${string}`,
            abi: REGISTRY_ABI,
            functionName: "hasRole",
            args: [MINTER_ROLE, address as `0x${string}`],
          }) as boolean;
        } catch { /* registry may not support hasRole */ }
      }

      setEscrowState({
        beneficiary: beneficiary as string,
        holder: holder as string,
        nominee: nominee as string,
        prevBeneficiary: prevBeneficiary as string,
        prevHolder: prevHolder as string,
        isHoldingToken: isHoldingToken as boolean,
        isAcceptor,
      });
    } catch (e) {
      console.error("fetchEscrowState error:", e);
    }
  }, [TITLE_ESCROW_ADDRESS, address, registryAddress, titleEscrowAddress]);

  useEffect(() => { fetchEscrowState(); }, [fetchEscrowState]);

  // Auto-select first available action when conditions change
  const availableActions = computeAvailableActions(escrowState, address);
  useEffect(() => {
    if (!activeAction || !availableActions.includes(activeAction)) {
      setActiveAction(availableActions[0] ?? null);
    }
  }, [availableActions.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildCalldata(): `0x${string}` {
    const remarkBytes = toRemarkBytes(remark);
    switch (activeAction) {
      case "nominate":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "nominate", args: [targetAddress as `0x${string}`, remarkBytes] });
      case "transferBeneficiary":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "transferBeneficiary", args: [targetAddress as `0x${string}`, remarkBytes] });
      case "transferHolder":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "transferHolder", args: [targetAddress as `0x${string}`, remarkBytes] });
      case "transferOwners":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "transferOwners", args: [targetAddress as `0x${string}`, secondAddress as `0x${string}`, remarkBytes] });
      case "rejectBeneficiary":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "rejectTransferBeneficiary", args: [remarkBytes] });
      case "rejectHolder":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "rejectTransferHolder", args: [remarkBytes] });
      case "rejectOwners":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "rejectTransferOwners", args: [remarkBytes] });
      case "returnToIssuer":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "returnToIssuer", args: [remarkBytes] });
      case "shred":
        return encodeFunctionData({ abi: TITLE_ESCROW_ABI, functionName: "shred", args: [remarkBytes] });
      default:
        throw new Error("Unknown action");
    }
  }

  async function handleSend() {
    if (!address || !activeAction) return;
    setError(null);
    setLastTx(null);
    setLoading(true);
    try {
      const calldata = buildCalldata();
      let txHash: string;

      if (isDelegated) {
        const { smartAccountClient } = await buildSmartAccountClient(
          address as `0x${string}`,
          paymasterAddress as `0x${string}`,
        );
        txHash = await smartAccountClient.sendTransaction({ to: TITLE_ESCROW_ADDRESS, value: 0n, data: calldata });
      } else {
        const walletClient = createWalletClient({ account: address as `0x${string}`, chain: sepolia, transport: custom(window.ethereum) });
        txHash = await walletClient.sendTransaction({ to: TITLE_ESCROW_ADDRESS, value: 0n, data: calldata });
        await getPublicClient().waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      }

      setLastTx({ hash: txHash, gasless: isDelegated });
      await fetchEscrowState();
      setTargetAddress("");
      setSecondAddress("");
      setRemark("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const disabled = !address || !!!paymasterAddress || !titleEscrowAddress;
  const needsAddress = activeAction ? ADDRESS_ACTIONS.includes(activeAction) : false;
  const needsDualAddress = activeAction ? DUAL_ADDRESS_ACTIONS.includes(activeAction) : false;
  const isRemarkOnly = activeAction ? REMARK_ONLY_ACTIONS.includes(activeAction) : false;

  const canSend =
    !disabled &&
    !loading &&
    !!activeAction &&
    (isRemarkOnly ||
      (needsAddress && targetAddress.startsWith("0x")) ||
      (needsDualAddress && targetAddress.startsWith("0x") && secondAddress.startsWith("0x")));

  return (
    <div className={`panel ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <p className="panel-title mb-0">TrustVC Operations</p>
        {isDelegated
          ? <span className="text-xs text-emerald-400">gasless via UserOp</span>
          : <span className="text-xs text-yellow-400">regular tx · pays gas</span>}
      </div>

      {!address && <p className="text-xs text-yellow-400 mb-4">Connect wallet first.</p>}
      {address && !!!paymasterAddress && <p className="text-xs text-yellow-400 mb-4">Set up a paymaster first.</p>}
      {address && !!paymasterAddress && !titleEscrowAddress && <p className="text-xs text-yellow-400 mb-4">Set up a title escrow first.</p>}

      {/* TitleEscrow state */}
      {escrowState && (
        <div className="bg-gray-800/60 rounded-lg p-3 mb-5 space-y-1.5">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">TitleEscrow State</p>
          <StateRow label="Beneficiary" value={escrowState.beneficiary} highlight={address?.toLowerCase() === escrowState.beneficiary.toLowerCase()} />
          <StateRow label="Holder" value={escrowState.holder} highlight={address?.toLowerCase() === escrowState.holder.toLowerCase()} />
          <StateRow label="Nominee" value={escrowState.nominee === ZERO_ADDR ? "none" : escrowState.nominee} />
          {escrowState.prevBeneficiary !== ZERO_ADDR && (
            <StateRow label="Prev Beneficiary" value={escrowState.prevBeneficiary} />
          )}
          {escrowState.prevHolder !== ZERO_ADDR && (
            <StateRow label="Prev Holder" value={escrowState.prevHolder} />
          )}
          <div className="flex gap-2 text-xs">
            <span className="text-gray-500 w-28 shrink-0">Status:</span>
            <span className={escrowState.isHoldingToken ? "text-emerald-400" : "text-yellow-400"}>
              {escrowState.isHoldingToken ? "Active" : "Returned to issuer"}
            </span>
          </div>
          <button className="text-xs text-indigo-400 hover:text-indigo-300 mt-1" onClick={fetchEscrowState}>
            Refresh
          </button>
        </div>
      )}

      {/* Action selector — only available actions */}
      {availableActions.length === 0 && !disabled && (
        <p className="text-xs text-gray-500 mb-4">No actions available for your address on this document.</p>
      )}

      {availableActions.length > 0 && (
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Action</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {availableActions.map((action) => (
              <button
                key={action}
                onClick={() => { setActiveAction(action); setError(null); setLastTx(null); }}
                className={`text-xs px-2 py-1.5 rounded-lg border transition-all ${
                  activeAction === action
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-indigo-600"
                } ${action === "shred" ? "!border-red-800 hover:!border-red-600 text-red-400" : ""}`}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Inputs */}
      {activeAction && availableActions.length > 0 && (
        <div className="space-y-2 mb-4">
          {(needsAddress || needsDualAddress) && (
            <input
              className="input"
              placeholder={activeAction === "transferOwners" ? "Nominee address (0x...)" : "Target address (0x...)"}
              value={targetAddress}
              onChange={(e) => setTargetAddress(e.target.value)}
              disabled={disabled}
            />
          )}
          {needsDualAddress && (
            <input
              className="input"
              placeholder="New holder address (0x...)"
              value={secondAddress}
              onChange={(e) => setSecondAddress(e.target.value)}
              disabled={disabled}
            />
          )}
          <input
            className="input"
            placeholder="Remark (optional)"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            disabled={disabled}
          />
        </div>
      )}

      {activeAction && availableActions.length > 0 && (
        <button
          className={`btn-primary w-full ${activeAction === "shred" ? "!bg-red-700 hover:!bg-red-600" : ""}`}
          onClick={handleSend}
          disabled={!canSend}
        >
          {loading
            ? isDelegated ? "Sending UserOp..." : "Sending tx..."
            : `${ACTION_LABELS[activeAction]}${isDelegated ? " (gasless)" : ""}`}
        </button>
      )}

      {lastTx && (
        <div className="mt-3 bg-emerald-900/30 border border-emerald-700/40 rounded-lg p-3">
          <p className="text-xs text-emerald-400 font-medium mb-1">
            Transaction confirmed ✓ {lastTx.gasless ? "(gasless)" : "(gas paid)"}
          </p>
          <a
            href={`https://sepolia.etherscan.io/tx/${lastTx.hash}`}
            target="_blank" rel="noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300 font-mono break-all"
          >
            {lastTx.hash}
          </a>
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-3 break-all">{error}</p>}
    </div>
  );
}

function StateRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500 w-28 shrink-0">{label}:</span>
      <span className={`break-all font-mono ${highlight ? "text-indigo-300" : "text-gray-300"}`}>{value}</span>
    </div>
  );
}
