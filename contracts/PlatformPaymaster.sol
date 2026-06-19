// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/core/Helpers.sol";

interface ITDocDeployer {
    function deploy(
        address implementation,
        bytes memory params
    ) external returns (address);
}

interface ITradeTrustToken {
    function mint(
        address beneficiary,
        address holder,
        uint256 tokenId,
        bytes calldata remark
    ) external returns (address);
}

interface IAccessControl {
    function grantRole(bytes32 role, address account) external;
    function renounceRole(bytes32 role, address callerConfirmation) external;
}

/**
 * PlatformPaymaster — validates by inspecting the target contract in callData.
 *
 * Validation strategy (no third-party storage reads → bundler compliant):
 *   1. Decode userOp.callData → must be execute(address to, uint256, bytes)
 *   2. Check `to` is in authorizedRegistries (paymaster's own storage)
 *   3. Check daily spend (paymaster's own storage — always allowed)
 *
 * Access control is enforced by the Storage contract itself:
 *   require(msg.sender == beneficiary || msg.sender == holder)
 * so non-beneficiary/holder callers are rejected at execution time.
 * If the call reverts, _postOp skips the spend update.
 */
contract PlatformPaymaster is BasePaymaster {
    bytes4 private constant EXECUTE_SEL =
        bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant DEPLOY_REGISTRY_SEL =
        bytes4(keccak256("deployRegistry(address,string,string)"));
    bytes4 private constant MINT_DOCUMENT_SEL =
        bytes4(keccak256("mintDocument(address,address,address,uint256,bytes)"));

    bytes32 private constant DEFAULT_ADMIN_ROLE = bytes32(0);

    ITDocDeployer public tdocDeployer;

    // Paymaster's own storage — always allowed under ERC-7562
    mapping(address => bool) public authorizedRegistries;
    mapping(address => bool) public authorizedTitleEscrows;
    // remaining deployment credits per user; max 3 per user
    mapping(address => uint256) public userWhitelist;

    // Daily spend tracking — paymaster's own storage, always allowed
    mapping(address => uint256) public dailySpend;
    mapping(address => uint256) public lastReset;
    uint256 public dailyLimit;

    event RegistryAdded(address indexed registry);
    event RegistryRemoved(address indexed registry);
    event TitleEscrowLinked(address indexed titleEscrow, address indexed registry);
    event UserWhitelistUpdated(address indexed user, uint256 credits);
    event RegistryDeployed(
        address indexed user,
        address indexed deployed,
        uint256 creditsLeft
    );
    event UserOpSponsored(address indexed user, uint256 gasCost);
    event UserOpRejected(address indexed user, string reason);
    event DailyLimitUpdated(uint256 newLimit);

    constructor(
        IEntryPoint _entryPoint,
        address _owner,
        uint256 _dailyLimit
    ) BasePaymaster(_entryPoint) {
        _transferOwnership(_owner);
        dailyLimit = _dailyLimit;
    }

    function setTdocDeployer(address _tdocDeployer) external onlyOwner {
        require(_tdocDeployer != address(0), "Zero address");
        tdocDeployer = ITDocDeployer(_tdocDeployer);
    }

    // Grant/update deployment credits for a user; credits cannot exceed 3
    function setUserWhitelist(
        address user,
        uint256 credits
    ) external onlyOwner {
        require(user != address(0), "Zero address");
        require(credits <= 3, "Exceeds max credits of 3");
        userWhitelist[user] = credits;
        emit UserWhitelistUpdated(user, credits);
    }

    // Deploys a TDoc clone on behalf of a whitelisted user; consumes one credit.
    // Role setup (atomic, no follow-up txs needed):
    //   - msg.sender (EOA) gets DEFAULT_ADMIN_ROLE
    //   - paymaster gets MINTER_ROLE + RESTORER_ROLE + ACCEPTER_ROLE
    function deployRegistry(
        address implementation,
        string memory name,
        string memory symbol
    ) external returns (address deployed) {
        require(address(tdocDeployer) != address(0), "TdocDeployer not set");
        uint256 credits = userWhitelist[msg.sender];
        require(credits > 0, "No deployment credits");

        userWhitelist[msg.sender] = credits - 1;

        // Paymaster is temporary admin so it can configure roles after deploy
        bytes memory params = abi.encode(name, symbol, address(this));
        deployed = tdocDeployer.deploy(implementation, params);

        // Hand admin to the calling EOA
        IAccessControl(deployed).grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Paymaster keeps only the operational roles it needs
        // (MINTER_ROLE, RESTORER_ROLE, ACCEPTER_ROLE were granted to address(this) via initialize)

        // Relinquish admin — EOA is now sole admin
        IAccessControl(deployed).renounceRole(DEFAULT_ADMIN_ROLE, address(this));

        authorizedRegistries[deployed] = true;
        emit RegistryAdded(deployed);
        emit RegistryDeployed(msg.sender, deployed, credits - 1);
    }

    // Mints a TradeTrust document, captures the TitleEscrow, and auto-authorizes it.
    // Paymaster must hold MINTER_ROLE on the registry.
    // Callable gaslessly by userWhitelist users (credits not consumed — only deployRegistry uses credits).
    function mintDocument(
        address registry,
        address beneficiary,
        address holder,
        uint256 tokenId,
        bytes calldata remark
    ) external returns (address titleEscrow) {
        require(authorizedRegistries[registry], "registry not authorized");
        require(userWhitelist[msg.sender] > 0, "not whitelisted");

        titleEscrow = ITradeTrustToken(registry).mint(beneficiary, holder, tokenId, remark);

        authorizedTitleEscrows[titleEscrow] = true;
        emit TitleEscrowLinked(titleEscrow, registry);
    }

    function addRegistry(address registry) external onlyOwner {
        require(registry != address(0), "Zero address");
        authorizedRegistries[registry] = true;
        emit RegistryAdded(registry);
    }

    function removeRegistry(address registry) external onlyOwner {
        authorizedRegistries[registry] = false;
        emit RegistryRemoved(registry);
    }

    function setDailyLimit(uint256 _dailyLimit) external onlyOwner {
        dailyLimit = _dailyLimit;
        emit DailyLimitUpdated(_dailyLimit);
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32, // userOpHash — not needed
        uint256 maxCost
    ) internal override returns (bytes memory context, uint256 validationData) {
        address sender = userOp.sender;

        // 1. callData must be long enough for selector + one address arg
        if (userOp.callData.length < 36) {
            emit UserOpRejected(sender, "callData too short");
            return ("", _packValidationData(true, 0, 0));
        }

        // 2. Must call execute(address,uint256,bytes)
        bytes4 sel = bytes4(userOp.callData[:4]);
        if (sel != EXECUTE_SEL) {
            emit UserOpRejected(sender, "wrong selector");
            return ("", _packValidationData(true, 0, 0));
        }

        // 3. Decode target and inner calldata
        (address target, , bytes memory innerData) = abi.decode(
            userOp.callData[4:],
            (address, uint256, bytes)
        );

        // Path A — calling an authorized registry or title escrow (regular sponsored op)
        if (authorizedRegistries[target] || authorizedTitleEscrows[target]) {
            if (dailyLimit > 0 && dailySpend[sender] + maxCost > dailyLimit) {
                emit UserOpRejected(sender, "daily limit exceeded");
                return ("", _packValidationData(true, 0, 0));
            }
            return (abi.encode(sender, maxCost, false), _packValidationData(false, 0, 0));
        }

        // Path B — gasless paymaster call (deployRegistry or mintDocument)
        // Double-spend safe: EntryPoint sequential nonces allow only one
        // pending UserOp per sender in the mempool at a time.
        if (target == address(this)) {
            if (userWhitelist[sender] == 0) {
                emit UserOpRejected(sender, "not whitelisted");
                return ("", _packValidationData(true, 0, 0));
            }
            bytes4 innerSel;
            assembly { innerSel := mload(add(innerData, 32)) }

            if (innerSel == DEPLOY_REGISTRY_SEL) {
                // credits consumed inside deployRegistry; flag as deployment to skip daily spend
                return (abi.encode(sender, maxCost, true), _packValidationData(false, 0, 0));
            }
            if (innerSel == MINT_DOCUMENT_SEL) {
                // credits NOT consumed; track daily spend normally
                return (abi.encode(sender, maxCost, false), _packValidationData(false, 0, 0));
            }

            emit UserOpRejected(sender, "unauthorized paymaster call");
            return ("", _packValidationData(true, 0, 0));
        }

        emit UserOpRejected(sender, "unauthorized target");
        return ("", _packValidationData(true, 0, 0));
    }

    function _postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 /*actualUserOpFeePerGas*/
    ) internal override {
        if (mode == PostOpMode.postOpReverted) return;

        (address sender, , bool isDeployment) = abi.decode(context, (address, uint256, bool));

        // Deployment ops are credit-gated; skip daily spend tracking for them
        if (!isDeployment) {
            if (block.timestamp > lastReset[sender] + 1 days) {
                dailySpend[sender] = 0;
                lastReset[sender] = block.timestamp;
            }
            dailySpend[sender] += actualGasCost;
        }

        emit UserOpSponsored(sender, actualGasCost);
    }

    // v0.8 contracts on Etherspot EntryPoint — skip interface mismatch check
    function _validateEntryPointInterface(IEntryPoint) internal pure override {}

    receive() external payable {
        deposit();
    }

    function getUserDailySpend(
        address user
    ) external view returns (uint256 spent, uint256 limit, uint256 resetsAt) {
        spent = dailySpend[user];
        limit = dailyLimit;
        resetsAt = lastReset[user] + 1 days;
    }
}
