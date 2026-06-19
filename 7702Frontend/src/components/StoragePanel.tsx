import { useState, useEffect, useCallback } from "react";
import { encodeFunctionData, parseAbiItem, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { buildSmartAccountClient } from "../lib/pimlico";
import { STORAGE_ADDRESS, SEPOLIA_RPC_URL } from "../lib/constants";
import { STORAGE_ABI } from "../lib/abis";

interface Item {
  id: number;
  data: string;
  deleted: boolean;
}

interface Props {
  address: string | null;
  isDelegated: boolean;
}

// Typed event definitions — getLogs returns decoded args when using these
const CREATED_EVENT = parseAbiItem(
  "event ItemCreated(uint256 indexed id, string data, uint256 timestamp)"
);
const UPDATED_EVENT = parseAbiItem(
  "event ItemUpdated(uint256 indexed id, string data, uint256 timestamp)"
);
const DELETED_EVENT = parseAbiItem("event ItemDeleted(uint256 indexed id)");

export function StoragePanel({ address, isDelegated }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [newData, setNewData] = useState("");
  const [updateId, setUpdateId] = useState("");
  const [updateData, setUpdateData] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(SEPOLIA_RPC_URL),
      });

      // getLogs with a typed parseAbiItem event returns fully-typed args
      const [created, updated, deleted] = await Promise.all([
        publicClient.getLogs({ address: STORAGE_ADDRESS, event: CREATED_EVENT, fromBlock: 0n }),
        publicClient.getLogs({ address: STORAGE_ADDRESS, event: UPDATED_EVENT, fromBlock: 0n }),
        publicClient.getLogs({ address: STORAGE_ADDRESS, event: DELETED_EVENT, fromBlock: 0n }),
      ]);

      const map: Record<number, Item> = {};

      for (const log of created) {
        const id = Number(log.args.id);
        map[id] = { id, data: log.args.data ?? "", deleted: false };
      }
      for (const log of updated) {
        const id = Number(log.args.id);
        if (map[id]) map[id].data = log.args.data ?? "";
      }
      for (const log of deleted) {
        const id = Number(log.args.id);
        if (map[id]) map[id].deleted = true;
      }

      setItems(Object.values(map).sort((a, b) => a.id - b.id));
    } catch (e) {
      console.error("fetchItems error:", e);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function sendUserOp(calldata: `0x${string}`, label: string) {
    if (!address) return;
    setError(null);
    setLastTx(null);
    setLoading(label);
    try {
      const { smartAccountClient } = await buildSmartAccountClient(
        address as `0x${string}`
      );
      const txHash = await smartAccountClient.sendTransaction({
        to: STORAGE_ADDRESS,
        value: 0n,
        data: calldata,
      });
      setLastTx(txHash);
      await fetchItems();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  async function handleCreate() {
    if (!newData.trim()) return;
    const data = encodeFunctionData({
      abi: STORAGE_ABI,
      functionName: "create",
      args: [newData.trim()],
    });
    await sendUserOp(data, "create");
    setNewData("");
  }

  async function handleUpdate() {
    if (!updateId || !updateData.trim()) return;
    const data = encodeFunctionData({
      abi: STORAGE_ABI,
      functionName: "update",
      args: [BigInt(updateId), updateData.trim()],
    });
    await sendUserOp(data, "update");
    setUpdateId("");
    setUpdateData("");
  }

  async function handleRemove() {
    if (!removeId) return;
    const data = encodeFunctionData({
      abi: STORAGE_ABI,
      functionName: "remove",
      args: [BigInt(removeId)],
    });
    await sendUserOp(data, "remove");
    setRemoveId("");
  }

  const disabled = !address || !isDelegated;

  return (
    <div className={`panel ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between mb-4">
        <p className="panel-title mb-0">Storage CRUD</p>
        <span className="text-xs text-gray-500">gasless via UserOp</span>
      </div>

      {disabled && (
        <p className="text-xs text-yellow-400 mb-4">
          {!address ? "Connect wallet first." : "Delegate your EOA first."}
        </p>
      )}

      {/* Item list */}
      <div className="mb-5">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
          Items on-chain
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-gray-600 italic">No items yet.</p>
        ) : (
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {items.map((item) => (
              <div
                key={item.id}
                className={`flex gap-2 text-sm px-3 py-1.5 rounded-lg ${
                  item.deleted
                    ? "bg-gray-800/40 text-gray-600 line-through"
                    : "bg-gray-800 text-gray-200"
                }`}
              >
                <span className="text-gray-500 w-6 shrink-0">#{item.id}</span>
                <span className="break-all">{item.data}</span>
              </div>
            ))}
          </div>
        )}
        <button
          className="text-xs text-indigo-400 hover:text-indigo-300 mt-2"
          onClick={fetchItems}
        >
          Refresh
        </button>
      </div>

      {/* Create */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
          Create
        </p>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="Item data..."
            value={newData}
            onChange={(e) => setNewData(e.target.value)}
            disabled={disabled}
          />
          <button
            className="btn-primary shrink-0"
            onClick={handleCreate}
            disabled={disabled || loading === "create" || !newData.trim()}
          >
            {loading === "create" ? "..." : "Create"}
          </button>
        </div>
      </div>

      {/* Update */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
          Update
        </p>
        <div className="flex gap-2">
          <input
            className="input w-20 shrink-0"
            placeholder="ID"
            type="number"
            min="1"
            value={updateId}
            onChange={(e) => setUpdateId(e.target.value)}
            disabled={disabled}
          />
          <input
            className="input"
            placeholder="New data..."
            value={updateData}
            onChange={(e) => setUpdateData(e.target.value)}
            disabled={disabled}
          />
          <button
            className="btn-primary shrink-0"
            onClick={handleUpdate}
            disabled={
              disabled ||
              loading === "update" ||
              !updateId ||
              !updateData.trim()
            }
          >
            {loading === "update" ? "..." : "Update"}
          </button>
        </div>
      </div>

      {/* Remove */}
      <div className="mb-4">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">
          Remove
        </p>
        <div className="flex gap-2">
          <input
            className="input w-32 shrink-0"
            placeholder="Item ID"
            type="number"
            min="1"
            value={removeId}
            onChange={(e) => setRemoveId(e.target.value)}
            disabled={disabled}
          />
          <button
            className="btn-danger shrink-0"
            onClick={handleRemove}
            disabled={disabled || loading === "remove" || !removeId}
          >
            {loading === "remove" ? "..." : "Remove"}
          </button>
        </div>
      </div>

      {lastTx && (
        <p className="text-xs text-emerald-400 mt-2 break-all">
          Tx: {lastTx}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-2 break-all">{error}</p>
      )}
    </div>
  );
}
