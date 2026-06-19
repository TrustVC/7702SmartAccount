import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { SEPOLIA_CHAIN_ID } from "../lib/constants";

interface Props {
  address: string | null;
  onConnect: (address: string) => void;
  onDisconnect: () => void;
}

export function WalletConnect({ address, onConnect, onDisconnect }: Props) {
  const [balance, setBalance] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const bal = await provider.getBalance(address);
        setBalance(ethers.formatEther(bal).slice(0, 7));
        const net = await provider.getNetwork();
        setNetwork(net.chainId.toString());
      } catch {
        // ignore
      }
    })();
  }, [address]);

  async function connect() {
    setError(null);
    if (!window.ethereum) {
      setError("MetaMask not detected. Install the Chrome extension.");
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      // Switch to Sepolia first
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
        });
      } catch {
        // chain not added — ignore, user can add manually
      }
      const accounts = await provider.send("eth_requestAccounts", []);
      onConnect(accounts[0] as string);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connection rejected");
    }
  }

  const isWrongNetwork = network && network !== SEPOLIA_CHAIN_ID.toString();

  return (
    <div className="panel flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="panel-title mb-1">Wallet</p>
        {address ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-300 font-mono">{address}</span>
            {balance && (
              <span className="text-xs text-gray-500">{balance} ETH</span>
            )}
            {isWrongNetwork && (
              <span className="badge-red">Wrong network — switch to Sepolia</span>
            )}
            {!isWrongNetwork && network && (
              <span className="badge-green">Sepolia</span>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Not connected</p>
        )}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>

      {address ? (
        <button className="btn-ghost" onClick={onDisconnect}>
          Disconnect
        </button>
      ) : (
        <button className="btn-primary" onClick={connect}>
          Connect MetaMask
        </button>
      )}
    </div>
  );
}
