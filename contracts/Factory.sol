// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PlatformPaymaster} from "./PlatformPaymaster.sol";
import {EIP7702Implementation} from "./EIP7702Implementation.sol";
import {
    IEntryPoint
} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

contract PlatformAccountFactory {
    IEntryPoint public immutable entryPoint;
    EIP7702Implementation public immutable implementation7702;

    event PlatformOnboarded(
        address indexed platformAddress,
        address indexed paymaster
    );

    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
        implementation7702 = new EIP7702Implementation(address(_entryPoint));
    }

    // ── Deploy paymaster for a platform ───────────────────────────────
    // platformAddress = platform's EOA → paymaster owner
    // dailyLimit      = wei per user per day (0 = unlimited)
    // salt            = for CREATE2
    // Registries are added after deployment via PlatformPaymaster.addRegistry()
    function deployPlatformPaymaster(
        address platformAddress,
        uint256 dailyLimit,
        bytes32 salt
    ) external returns (address paymaster) {
        paymaster = address(
            new PlatformPaymaster{salt: salt}(
                entryPoint,
                platformAddress,
                dailyLimit
            )
        );

        emit PlatformOnboarded(platformAddress, paymaster);
    }

    // ── Predict address before deploying ─────────────────────────────

    function computePaymasterAddress(
        address platformAddress,
        uint256 dailyLimit,
        bytes32 salt
    ) external view returns (address) {
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(PlatformPaymaster).creationCode,
                abi.encode(entryPoint, platformAddress, dailyLimit)
            )
        );
        return
            address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                address(this),
                                salt,
                                initHash
                            )
                        )
                    )
                )
            );
    }
}
