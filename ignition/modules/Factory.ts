import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Canonical EntryPoint v0.8 — native EIP-7702 support
const PIMLICO_ENTRY_POINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

const FactoryModule = buildModule("FactoryModule", (m) => {
  const entryPoint = m.getParameter("entryPoint", PIMLICO_ENTRY_POINT);

  const factory = m.contract("PlatformAccountFactory", [entryPoint]);

  return { factory };
});

export default FactoryModule;
