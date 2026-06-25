import { useState, useEffect, useCallback } from "react";
import { createWalletClient, createPublicClient, custom, http, parseAbi, parseEther, formatEther, isAddress } from "viem";
import { sepolia } from "viem/chains";
import { SEPOLIA_RPC_URL } from "../lib/constants";

const ENTRY_POINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as const;

const paymasterAbi = parseAbi([
  "function setTdocDeployer(address _tdocDeployer) external",
  "function setUserWhitelist(address user, uint256 credits) external",
  "function addStake(uint32 unstakeDelaySec) external payable",
  "function deposit() external payable",
]);

const entryPointAbi = parseAbi([
  "function getDepositInfo(address account) external view returns (uint256 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime)",
]);

interface DepositInfo {
  deposit: bigint;
  staked: boolean;
  stake: bigint;
  unstakeDelaySec: number;
}

interface Props {
  address: string | null;
  paymasterAddress: string | null;
}

export function PaymasterAdminPanel({ address, paymasterAddress }: Props) {
  const [depositInfo, setDepositInfo] = useState<DepositInfo | null>(null);

  const [deployerInput, setDeployerInput] = useState("");
  const [deployerLoading, setDeployerLoading] = useState(false);
  const [deployerError, setDeployerError] = useState<string | null>(null);
  const [deployerSuccess, setDeployerSuccess] = useState(false);

  const [whitelistInput, setWhitelistInput] = useState("");
  const [credits, setCredits] = useState("3");
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [whitelistError, setWhitelistError] = useState<string | null>(null);
  const [whitelistSuccess, setWhitelistSuccess] = useState<string | null>(null);

  const [fundAmount, setFundAmount] = useState("0.05");
  const [fundLoading, setFundLoading] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [fundSuccess, setFundSuccess] = useState(false);

  const [stakeAmount, setStakeAmount] = useState("0.01");
  const [unstakeDelay, setUnstakeDelay] = useState("86400");
  const [stakeLoading, setStakeLoading] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [stakeSuccess, setStakeSuccess] = useState(false);

  const disabled = !address || !paymasterAddress;

  const fetchDepositInfo = useCallback(async () => {
    if (!paymasterAddress) return;
    try {
      const publicClient = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });
      const raw = await publicClient.readContract({
        address: ENTRY_POINT,
        abi: entryPointAbi,
        functionName: "getDepositInfo",
        args: [paymasterAddress as `0x${string}`],
      }) as [bigint, boolean, bigint, number, number];
      setDepositInfo({ deposit: raw[0], staked: raw[1], stake: raw[2], unstakeDelaySec: raw[3] });
    } catch { /* ignore */ }
  }, [paymasterAddress]);

  useEffect(() => { fetchDepositInfo(); }, [fetchDepositInfo]);

  const publicClient = () => createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC_URL) });

  function walletClient() {
    return createWalletClient({
      account: address as `0x${string}`,
      chain: sepolia,
      transport: custom(window.ethereum),
    });
  }

  async function sendAndWait(fn: () => Promise<`0x${string}`>) {
    const hash = await fn();
    await publicClient().waitForTransactionReceipt({ hash });
    return hash;
  }

  async function handleSetDeployer() {
    if (!address || !paymasterAddress) return;
    setDeployerError(null); setDeployerSuccess(false);
    const addr = deployerInput.trim();
    if (!isAddress(addr)) { setDeployerError("Invalid address."); return; }
    setDeployerLoading(true);
    try {
      await sendAndWait(() => walletClient().writeContract({
        address: paymasterAddress as `0x${string}`,
        abi: paymasterAbi,
        functionName: "setTdocDeployer",
        args: [addr as `0x${string}`],
      }));
      setDeployerSuccess(true);
      setDeployerInput("");
    } catch (e: unknown) {
      setDeployerError(e instanceof Error ? e.message : String(e));
    } finally { setDeployerLoading(false); }
  }

  async function handleWhitelist() {
    if (!address || !paymasterAddress) return;
    setWhitelistError(null); setWhitelistSuccess(null);
    const addr = whitelistInput.trim();
    if (!isAddress(addr)) { setWhitelistError("Invalid address."); return; }
    const c = parseInt(credits);
    if (isNaN(c) || c < 0 || c > 3) { setWhitelistError("Credits must be 0–3."); return; }
    setWhitelistLoading(true);
    try {
      await sendAndWait(() => walletClient().writeContract({
        address: paymasterAddress as `0x${string}`,
        abi: paymasterAbi,
        functionName: "setUserWhitelist",
        args: [addr as `0x${string}`, BigInt(c)],
      }));
      setWhitelistSuccess(`${addr} whitelisted with ${c} credit${c !== 1 ? "s" : ""}.`);
      setWhitelistInput("");
    } catch (e: unknown) {
      setWhitelistError(e instanceof Error ? e.message : String(e));
    } finally { setWhitelistLoading(false); }
  }

  async function handleFund() {
    if (!address || !paymasterAddress) return;
    setFundError(null); setFundSuccess(false);
    const eth = parseFloat(fundAmount);
    if (isNaN(eth) || eth <= 0) { setFundError("Enter a valid ETH amount."); return; }
    setFundLoading(true);
    try {
      await sendAndWait(() => walletClient().writeContract({
        address: paymasterAddress as `0x${string}`,
        abi: paymasterAbi,
        functionName: "deposit",
        value: parseEther(fundAmount),
      }));
      setFundSuccess(true);
      await fetchDepositInfo();
    } catch (e: unknown) {
      setFundError(e instanceof Error ? e.message : String(e));
    } finally { setFundLoading(false); }
  }

  async function handleStake() {
    if (!address || !paymasterAddress) return;
    setStakeError(null); setStakeSuccess(false);
    const eth = parseFloat(stakeAmount);
    const delay = parseInt(unstakeDelay);
    if (isNaN(eth) || eth <= 0) { setStakeError("Enter a valid ETH amount."); return; }
    if (isNaN(delay) || delay < 1) { setStakeError("Enter a valid unstake delay (seconds)."); return; }
    setStakeLoading(true);
    try {
      await sendAndWait(() => walletClient().writeContract({
        address: paymasterAddress as `0x${string}`,
        abi: paymasterAbi,
        functionName: "addStake",
        args: [delay],
        value: parseEther(stakeAmount),
      }));
      setStakeSuccess(true);
      await fetchDepositInfo();
    } catch (e: unknown) {
      setStakeError(e instanceof Error ? e.message : String(e));
    } finally { setStakeLoading(false); }
  }

  return (
    <div className={`panel ${disabled ? "opacity-60" : ""}`}>
      <p className="panel-title mb-4">Paymaster Admin</p>

      {!paymasterAddress && (
        <p className="text-xs text-yellow-400 mb-4">Set up a paymaster first.</p>
      )}

      {/* EntryPoint status */}
      {depositInfo && (
        <div className="bg-gray-800/60 rounded-lg p-3 mb-5 space-y-1.5">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">EntryPoint Status</p>
          <div className="flex gap-2 text-xs">
            <span className="text-gray-600 w-28 shrink-0">Gas deposit:</span>
            <span className={`font-mono ${depositInfo.deposit > 0n ? "text-emerald-400" : "text-yellow-400"}`}>
              {formatEther(depositInfo.deposit)} ETH
            </span>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="text-gray-600 w-28 shrink-0">Stake:</span>
            <span className={`font-mono ${depositInfo.staked ? "text-emerald-400" : "text-yellow-400"}`}>
              {depositInfo.staked ? `${formatEther(depositInfo.stake)} ETH (locked ${depositInfo.unstakeDelaySec}s)` : "Not staked"}
            </span>
          </div>
          <button className="text-xs text-indigo-400 hover:text-indigo-300 mt-1" onClick={fetchDepositInfo}>
            Refresh
          </button>
        </div>
      )}

      {/* Fund gas pool */}
      <div className="mb-5">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Fund Gas Pool</p>
        <p className="text-xs text-gray-400 mb-2">
          Deposit ETH into the EntryPoint gas pool. This is what pays for sponsored UserOps.
        </p>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="ETH amount (e.g. 0.05)"
            value={fundAmount}
            onChange={(e) => { setFundAmount(e.target.value); setFundError(null); setFundSuccess(false); }}
            disabled={disabled || fundLoading}
          />
          <button className="btn-primary shrink-0" onClick={handleFund} disabled={disabled || fundLoading}>
            {fundLoading ? "Funding..." : "Fund"}
          </button>
        </div>
        {fundSuccess && <p className="text-xs text-emerald-400 mt-1">Gas pool funded ✓</p>}
        {fundError && <p className="text-xs text-red-400 mt-1 break-all">{fundError}</p>}
      </div>

      {/* Add stake */}
      <div className="mb-5">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Add Stake</p>
        <p className="text-xs text-gray-400 mb-2">
          Lock ETH as a bundler-compliance bond. Required for the paymaster to be accepted by bundlers.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            className="input flex-1"
            placeholder="ETH to stake (e.g. 0.01)"
            value={stakeAmount}
            onChange={(e) => { setStakeAmount(e.target.value); setStakeError(null); setStakeSuccess(false); }}
            disabled={disabled || stakeLoading}
          />
          <input
            className="input w-28 shrink-0"
            placeholder="Delay (sec)"
            value={unstakeDelay}
            onChange={(e) => setUnstakeDelay(e.target.value)}
            disabled={disabled || stakeLoading}
          />
          <button className="btn-primary shrink-0" onClick={handleStake} disabled={disabled || stakeLoading || depositInfo?.staked}>
            {stakeLoading ? "Staking..." : depositInfo?.staked ? "Staked ✓" : "Stake"}
          </button>
        </div>
        <p className="text-xs text-gray-600">Unstake delay: 86400 = 1 day (cannot be reduced once set)</p>
        {stakeSuccess && <p className="text-xs text-emerald-400 mt-1">Stake added ✓</p>}
        {stakeError && <p className="text-xs text-red-400 mt-1 break-all">{stakeError}</p>}
      </div>

      {/* Set TDoc Deployer */}
      <div className="mb-5">
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">TDoc Deployer</p>
        <p className="text-xs text-gray-400 mb-2">
          The factory contract that deploys TDoc registries. Required for <span className="font-mono text-gray-300">deployRegistry</span>.
        </p>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Deployer contract address (0x...)"
            value={deployerInput}
            onChange={(e) => { setDeployerInput(e.target.value); setDeployerError(null); setDeployerSuccess(false); }}
            disabled={disabled || deployerLoading}
          />
          <button className="btn-primary shrink-0" onClick={handleSetDeployer} disabled={disabled || deployerLoading || !deployerInput.trim()}>
            {deployerLoading ? "Setting..." : "Set"}
          </button>
        </div>
        {deployerSuccess && <p className="text-xs text-emerald-400 mt-1">TDoc deployer updated ✓</p>}
        {deployerError && <p className="text-xs text-red-400 mt-1 break-all">{deployerError}</p>}
      </div>

      {/* Whitelist User */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Whitelist User</p>
        <p className="text-xs text-gray-400 mb-2">
          Grant deployment credits (max 3) for gasless <span className="font-mono text-gray-300">deployRegistry</span> and <span className="font-mono text-gray-300">mintDocument</span>.
        </p>
        <div className="flex gap-2 mb-2">
          <input
            className="input flex-1"
            placeholder="User address (0x...)"
            value={whitelistInput}
            onChange={(e) => { setWhitelistInput(e.target.value); setWhitelistError(null); setWhitelistSuccess(null); }}
            disabled={disabled || whitelistLoading}
          />
          <select
            className="input w-20 shrink-0"
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
            disabled={disabled || whitelistLoading}
          >
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
          <button className="btn-primary shrink-0" onClick={handleWhitelist} disabled={disabled || whitelistLoading || !whitelistInput.trim()}>
            {whitelistLoading ? "Saving..." : "Whitelist"}
          </button>
        </div>
        <p className="text-xs text-gray-600">Credits: 1 = deployRegistry only · 2 = + mintDocument · 3 = max</p>
        {whitelistSuccess && <p className="text-xs text-emerald-400 mt-1">{whitelistSuccess} ✓</p>}
        {whitelistError && <p className="text-xs text-red-400 mt-1 break-all">{whitelistError}</p>}
      </div>
    </div>
  );
}
