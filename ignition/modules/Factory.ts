import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// Canonical EntryPoint v0.7 — supported by Pimlico
const PIMLICO_ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

const FactoryModule = buildModule("FactoryModule", (m) => {
  const entryPoint = m.getParameter("entryPoint", PIMLICO_ENTRY_POINT);

  const factory = m.contract("PlatformAccountFactory", [entryPoint]);

  return { factory };
});

export default FactoryModule;
