// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PlatformPaymaster} from "./PlatformPaymaster.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title PlatformAccountFactory
 * @notice Deploys PlatformPaymaster clones. Onboarding is owner-gated; CREATE2 salt is
 * bound to `platformAddress` so the same user salt cannot collide across platforms or be
 * front-run for a different platform's predicted address.
 */
contract PlatformAccountFactory is Ownable {
    address public tdocDeployer;
    address public paymasterImplementation;
    /// @dev Not exposed in ABI (private). Prevents duplicate platform onboarding.
    mapping(address => address) private _attachedPaymaster;

    event PlatformOnboarded(
        address indexed platformAddress,
        address indexed paymaster
    );
    event TdocDeployerUpdated(address indexed newDeployer);
    event ImplementationUpdated(address indexed newImplementation);

    constructor(
        address _tdocDeployer,
        address _paymasterImplementation
    ) Ownable(msg.sender) {
        require(_tdocDeployer != address(0), "Zero address");
        require(_paymasterImplementation != address(0), "Zero address");
        tdocDeployer = _tdocDeployer;
        paymasterImplementation = _paymasterImplementation;
    }

    function updateTdocDeployer(address _tdocDeployer) external onlyOwner {
        require(_tdocDeployer != address(0), "Zero address");
        tdocDeployer = _tdocDeployer;
        emit TdocDeployerUpdated(_tdocDeployer);
    }

    function updatePaymasterImplementation(address _impl) external onlyOwner {
        require(_impl != address(0), "Zero address");
        paymasterImplementation = _impl;
        emit ImplementationUpdated(_impl);
    }

    /// @notice Owner-only onboarding. CREATE2 uses `keccak256(abi.encode(platformAddress, salt))`
    /// so the deterministic address is bound to the platform, not salt alone.
    function deployPlatformPaymaster(
        address platformAddress,
        uint256 dailyLimit,
        bytes32 salt
    ) external onlyOwner returns (address paymaster) {
        require(platformAddress != address(0), "Zero address");
        require(
            _attachedPaymaster[platformAddress] == address(0),
            "Already onboarded"
        );

        bytes32 boundSalt = _boundSalt(platformAddress, salt);
        paymaster = Clones.cloneDeterministic(paymasterImplementation, boundSalt);
        PlatformPaymaster(payable(paymaster)).initialize(
            platformAddress,
            dailyLimit,
            tdocDeployer
        );
        _attachedPaymaster[platformAddress] = paymaster;
        emit PlatformOnboarded(platformAddress, paymaster);
    }

    /// @notice Predict clone address for a platform + salt pair (matches deploy).
    function computePaymasterAddress(
        address platformAddress,
        bytes32 salt
    ) external view returns (address) {
        return
            Clones.predictDeterministicAddress(
                paymasterImplementation,
                _boundSalt(platformAddress, salt),
                address(this)
            );
    }

    /// @dev Legacy overload: `salt` must already be the bound value
    /// `keccak256(abi.encode(platformAddress, userSalt))`. Prefer the two-arg form.
    function computePaymasterAddress(
        bytes32 salt
    ) external view returns (address) {
        return
            Clones.predictDeterministicAddress(
                paymasterImplementation,
                salt,
                address(this)
            );
    }

    function _boundSalt(
        address platformAddress,
        bytes32 salt
    ) private pure returns (bytes32) {
        return keccak256(abi.encode(platformAddress, salt));
    }
}
