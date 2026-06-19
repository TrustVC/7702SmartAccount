// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {SignerEIP7702} from "@openzeppelin/contracts/utils/cryptography/signers/SignerEIP7702.sol";
import {EIP7702Utils} from "@openzeppelin/contracts/account/utils/EIP7702Utils.sol";
import {ERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import {IEntryPoint} from "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";

/**
 * EIP-7702 smart account implementation using OpenZeppelin base contracts.
 *
 * Inheritance stack:
 *   Account          — ERC-4337 validateUserOp, onlyEntryPoint guards, pre-fund payment
 *   SignerEIP7702    — _rawSignatureValidation: recovers signer and checks == address(this)
 *   ERC7821          — standardized batch execute(bytes32 mode, bytes executionData)
 *   ERC165           — supportsInterface
 *
 * EIP-7702 flow: deploy this contract once, then have EOAs sign an authorization
 * pointing to this address. The EOA's code becomes `0xef0100 || address(this)`,
 * giving it full smart-account capabilities while keeping the original private key.
 */
contract EIP7702Implementation is Account, SignerEIP7702, ERC7821, ERC165 {
    // Baked into bytecode at deploy time so EIP-7702 delegating EOAs inherit
    // the correct EntryPoint without any storage reads.
    IEntryPoint private immutable _entryPoint;

    // Takes address so callers don't need OZ's IEntryPoint type in scope.
    constructor(address entryPoint_) {
        _entryPoint = IEntryPoint(entryPoint_);
    }

    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    // -------------------------------------------------------------------------
    // Execution
    // -------------------------------------------------------------------------

    /**
     * @dev Allow the EntryPoint (in addition to address(this)) to call the
     * ERC-7821 batch execute function. Without this override only the account
     * itself can trigger execution.
     */
    function _erc7821AuthorizedExecutor(
        address caller,
        bytes32 mode,
        bytes calldata executionData
    ) internal view virtual override returns (bool) {
        return caller == address(entryPoint()) || super._erc7821AuthorizedExecutor(caller, mode, executionData);
    }

    /**
     * @dev Convenience single-call path. Only callable by the EntryPoint or the
     * account itself — prevents arbitrary callers from draining funds.
     *
     * For batch calls use the ERC-7821 `execute(bytes32 mode, bytes executionData)`
     * inherited from ERC7821 with mode = 0x0100000000000000000000000000000000000000000000000000000000000000
     * and executionData = abi.encode(calls) where calls is (address,uint256,bytes)[].
     */
    function execute(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyEntryPointOrSelf returns (bytes memory) {
        (bool ok, bytes memory result) = to.call{value: value}(data);
        require(ok, "execution failed");
        return result;
    }

    // -------------------------------------------------------------------------
    // ERC-165
    // -------------------------------------------------------------------------

    /**
     * @dev Advertise ERC-7821 (batch executor) and ERC-165 support.
     * The ERC-7821 interface ID 0x4e49c5c7 is the XOR of:
     *   execute(bytes32,bytes).selector ^ supportsExecutionMode(bytes32).selector
     */
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == 0x4e49c5c7 // ERC-7821 batch executor
            || super.supportsInterface(interfaceId); // covers 0x01ffc9a7 (ERC-165)
    }

    // -------------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------------

    /**
     * @dev Returns the implementation address this EOA has delegated to via
     * EIP-7702, or address(0) if no delegation is active.
     */
    function getDelegate() external view returns (address) {
        return EIP7702Utils.fetchDelegate(address(this));
    }
}
