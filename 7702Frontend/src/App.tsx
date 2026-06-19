import { useState } from "react";
import { WalletConnect } from "./components/WalletConnect";
import { DelegationPanel } from "./components/DelegationPanel";
import { TrustVCPanel } from "./components/TrustVCPanel";

export default function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [isDelegated, setIsDelegated] = useState(false);

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto space-y-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          TrustVC <span className="text-indigo-400">EIP-7702</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Gasless trade document operations via Account Abstraction · Sepolia
        </p>
      </div>

      <WalletConnect
        address={address}
        onConnect={setAddress}
        onDisconnect={() => {
          setAddress(null);
          setIsDelegated(false);
        }}
      />

      <DelegationPanel address={address} onDelegated={setIsDelegated} />

      <TrustVCPanel address={address} isDelegated={isDelegated} />

      <p className="text-xs text-gray-700 text-center pt-4">
        EIP-7702 · ERC-4337 · Pimlico Bundler · Sepolia Testnet
      </p>
    </div>
  );
}
