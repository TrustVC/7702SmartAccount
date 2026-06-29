// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockRegistry} from "./MockRegistry.sol";

/// Simulates TDocDeployer.deploy(implementation, params).
/// params is abi.encode(name, symbol, admin) — the third element is the initial admin
/// (address(this) = the paymaster), matching PlatformPaymaster.deployRegistry().
contract MockTdocDeployer {
    function deploy(
        address, /* implementation — ignored in mock */
        bytes memory params
    ) external returns (address) {
        (, , address admin) = abi.decode(params, (string, string, address));
        return address(new MockRegistry(admin));
    }
}
