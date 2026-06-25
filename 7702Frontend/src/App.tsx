import { useState } from "react";
import { WalletConnect } from "./components/WalletConnect";
import { PaymasterPanel } from "./components/PaymasterPanel";
import { PaymasterAdminPanel } from "./components/PaymasterAdminPanel";
import { RegistryPanel } from "./components/RegistryPanel";
import { TitleEscrowPanel } from "./components/TitleEscrowPanel";
import { DelegationPanel } from "./components/DelegationPanel";
import { TrustVCPanel } from "./components/TrustVCPanel";
import { PAYMASTER_ADDRESS } from "./lib/constants";

export default function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [isDelegated, setIsDelegated] = useState(false);
  const [paymasterAddress, setPaymasterAddress] = useState<`0x${string}` | null>(
    PAYMASTER_ADDRESS && PAYMASTER_ADDRESS !== "0x" ? PAYMASTER_ADDRESS : null
  );
  const [registryAddress, setRegistryAddress] = useState<`0x${string}` | null>(null);
  const [titleEscrowAddress, setTitleEscrowAddress] = useState<`0x${string}` | null>(null);

  function handleDisconnect() {
    setAddress(null);
    setIsDelegated(false);
    setRegistryAddress(null);
    setTitleEscrowAddress(null);
  }

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
        onDisconnect={handleDisconnect}
      />

      <PaymasterPanel
        address={address}
        onPaymasterDeployed={setPaymasterAddress}
      />

      <PaymasterAdminPanel
        address={address}
        paymasterAddress={paymasterAddress}
      />

      <RegistryPanel
        address={address}
        paymasterAddress={paymasterAddress}
        isDelegated={isDelegated}
        onRegistryReady={setRegistryAddress}
      />

      <TitleEscrowPanel
        address={address}
        isDelegated={isDelegated}
        paymasterAddress={paymasterAddress}
        registryAddress={registryAddress}
        onTitleEscrowReady={setTitleEscrowAddress}
      />

      <DelegationPanel address={address} onDelegated={setIsDelegated} />

      <TrustVCPanel
        address={address}
        isDelegated={isDelegated}
        paymasterAddress={paymasterAddress}
        titleEscrowAddress={titleEscrowAddress}
        registryAddress={registryAddress}
      />

      <p className="text-xs text-gray-700 text-center pt-4">
        EIP-7702 · ERC-4337 · Pimlico Bundler · Sepolia Testnet
      </p>
    </div>
  );
}
