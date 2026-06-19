import { useState, useEffect, useCallback } from "react";
import { encodeFunctionData, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { buildSmartAccountClient, toRemarkBytes } from "../lib/pimlico";
import {
  TITLE_ESCROW_ADDRESS,
  REGISTRY_ADDRESS,
  SEPOLIA_RPC_URL,
} from "../lib/constants";
import { TITLE_ESCROW_ABI } from "../lib/abis";

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
  isHoldingToken: boolean;
}

interface Props {
  address: string | null;
  isDelegated: boolean;
}

const ACTION_LABELS: Record<Action, string> = {
  nominate: "Nominate",
  transferBeneficiary: "Transfer Beneficiary",
  transferHolder: "Transfer Holder",
  transferOwners: "Transfer Owners",
  rejectBeneficiary: "Reject Transfer (Beneficiary)",
  rejectHolder: "Reject Transfer (Holder)",
  rejectOwners: "Reject Transfer (Owners)",
  returnToIssuer: "Return to Issuer",
  shred: "Shred Document",
};

const ADDRESS_ACTIONS: Action[] = [
  "nominate",
  "transferBeneficiary",
  "transferHolder",
];
const DUAL_ADDRESS_ACTIONS: Action[] = ["transferOwners"];
const REMARK_ONLY_ACTIONS: Action[] = [
  "rejectBeneficiary",
  "rejectHolder",
  "rejectOwners",
  "returnToIssuer",
  "shred",
];

export function TrustVCPanel({ address, isDelegated }: Props) {
  const [escrowState, setEscrowState] = useState<EscrowState | null>(null);
  const [activeAction, setActiveAction] = useState<Action>("nominate");
  const [targetAddress, setTargetAddress] = useState("");
  const [secondAddress, setSecondAddress] = useState("");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchEscrowState = useCallback(async () => {
    try {
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(SEPOLIA_RPC_URL),
      });
      const [beneficiary, holder, nominee, isHoldingToken] = await Promise.all([
        publicClient.readContract({
          address: TITLE_ESCROW_ADDRESS,
          abi: TITLE_ESCROW_ABI,
          functionName: "beneficiary",
        }),
        publicClient.readContract({
          address: TITLE_ESCROW_ADDRESS,
          abi: TITLE_ESCROW_ABI,
          functionName: "holder",
        }),
        publicClient.readContract({
          address: TITLE_ESCROW_ADDRESS,
          abi: TITLE_ESCROW_ABI,
          functionName: "nominee",
        }),
        publicClient.readContract({
          address: TITLE_ESCROW_ADDRESS,
          abi: TITLE_ESCROW_ABI,
          functionName: "isHoldingToken",
        }),
      ]);
      setEscrowState({
        beneficiary: beneficiary as string,
        holder: holder as string,
        nominee: nominee as string,
        isHoldingToken: isHoldingToken as boolean,
      });
    } catch (e) {
      console.error("fetchEscrowState error:", e);
    }
  }, []);

  useEffect(() => {
    fetchEscrowState();
  }, [fetchEscrowState]);

  function buildCalldata(): `0x${string}` {
    const remarkBytes = toRemarkBytes(remark);

    if (activeAction === "nominate") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "nominate",
        args: [targetAddress as `0x${string}`, remarkBytes],
      });
    }
    if (activeAction === "transferBeneficiary") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "transferBeneficiary",
        args: [targetAddress as `0x${string}`, remarkBytes],
      });
    }
    if (activeAction === "transferHolder") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "transferHolder",
        args: [targetAddress as `0x${string}`, remarkBytes],
      });
    }
    if (activeAction === "transferOwners") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "transferOwners",
        args: [
          targetAddress as `0x${string}`,
          secondAddress as `0x${string}`,
          remarkBytes,
        ],
      });
    }
    if (activeAction === "rejectBeneficiary") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "rejectTransferBeneficiary",
        args: [remarkBytes],
      });
    }
    if (activeAction === "rejectHolder") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "rejectTransferHolder",
        args: [remarkBytes],
      });
    }
    if (activeAction === "rejectOwners") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "rejectTransferOwners",
        args: [remarkBytes],
      });
    }
    if (activeAction === "returnToIssuer") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "returnToIssuer",
        args: [remarkBytes],
      });
    }
    if (activeAction === "shred") {
      return encodeFunctionData({
        abi: TITLE_ESCROW_ABI,
        functionName: "shred",
        args: [remarkBytes],
      });
    }
    throw new Error("Unknown action");
  }

  async function handleSend() {
    if (!address) return;
    setError(null);
    setLastTx(null);
    setLoading(true);
    try {
      const calldata = buildCalldata();
      const { smartAccountClient } = await buildSmartAccountClient(
        address as `0x${string}`
      );
      const txHash = await smartAccountClient.sendTransaction({
        to: TITLE_ESCROW_ADDRESS,
        value: 0n,
        data: calldata,
      });
      setLastTx(txHash);
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

  // isDelegated is informational — permissionless auto-delegates on the first UserOp
  const disabled = !address;
  const needsAddress = ADDRESS_ACTIONS.includes(activeAction);
  const needsDualAddress = DUAL_ADDRESS_ACTIONS.includes(activeAction);
  const isRemarkOnly = REMARK_ONLY_ACTIONS.includes(activeAction);

  const canSend =
    !disabled &&
    !loading &&
    (isRemarkOnly ||
      (needsAddress && targetAddress.startsWith("0x")) ||
      (needsDualAddress &&
        targetAddress.startsWith("0x") &&
        secondAddress.startsWith("0x")));

  return (
    <div className={`panel ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <p className="panel-title mb-0">TrustVC Operations</p>
        <span className="text-xs text-gray-500">gasless via UserOp</span>
      </div>

      {disabled && (
        <p className="text-xs text-yellow-400 mb-4">Connect wallet first.</p>
      )}

      {/* TitleEscrow state */}
      {escrowState && (
        <div className="bg-gray-800/60 rounded-lg p-3 mb-5 space-y-1.5">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
            TitleEscrow State
          </p>
          <StateRow label="Beneficiary" value={escrowState.beneficiary} />
          <StateRow label="Holder" value={escrowState.holder} />
          <StateRow
            label="Nominee"
            value={
              escrowState.nominee === "0x0000000000000000000000000000000000000000"
                ? "none"
                : escrowState.nominee
            }
          />
          <div className="flex gap-2 text-xs">
            <span className="text-gray-500 w-28 shrink-0">Token held:</span>
            <span
              className={
                escrowState.isHoldingToken ? "text-emerald-400" : "text-gray-500"
              }
            >
              {escrowState.isHoldingToken ? "Yes" : "No"}
            </span>
          </div>
          <button
            className="text-xs text-indigo-400 hover:text-indigo-300 mt-1"
            onClick={fetchEscrowState}
          >
            Refresh
          </button>
        </div>
      )}

      {/* Action selector */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
          Action
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {(Object.keys(ACTION_LABELS) as Action[]).map((action) => (
            <button
              key={action}
              onClick={() => {
                setActiveAction(action);
                setError(null);
                setLastTx(null);
              }}
              className={`text-xs px-2 py-1.5 rounded-lg border transition-all ${
                activeAction === action
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-indigo-600"
              }`}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="space-y-2 mb-4">
        {(needsAddress || needsDualAddress) && (
          <input
            className="input"
            placeholder={
              activeAction === "transferOwners"
                ? "Nominee address (0x...)"
                : "Target address (0x...)"
            }
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

      <button
        className={`btn-primary w-full ${activeAction === "shred" ? "!bg-red-700 hover:!bg-red-600" : ""}`}
        onClick={handleSend}
        disabled={!canSend}
      >
        {loading
          ? "Sending UserOp..."
          : `Send: ${ACTION_LABELS[activeAction]}`}
      </button>

      {lastTx && (
        <p className="text-xs text-emerald-400 mt-3 break-all">
          Tx: {lastTx}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-3 break-all">{error}</p>
      )}
    </div>
  );
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500 w-28 shrink-0">{label}:</span>
      <span className="text-gray-300 break-all font-mono">{value}</span>
    </div>
  );
}
