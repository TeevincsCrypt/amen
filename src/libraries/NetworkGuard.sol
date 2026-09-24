// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Errors} from "./Errors.sol";

/// @title NetworkGuard
/// @notice Amen is built for Robinhood Chain only: its session and oracle assumptions are
///         specific to official Robinhood Stock Tokens and their Chainlink feeds.
///         Deployment reverts anywhere else, except local anvil (31337), which carries no real
///         funds and is used for the scripted demo (script/local-demo.sh).
abstract contract NetworkGuard {
    uint256 internal constant ROBINHOOD_MAINNET = 4663;
    uint256 internal constant ROBINHOOD_TESTNET = 46630;
    uint256 internal constant LOCAL_ANVIL = 31337;

    constructor() {
        _requireRobinhood();
    }

    function _requireRobinhood() internal view {
        if (
            block.chainid != ROBINHOOD_MAINNET && block.chainid != ROBINHOOD_TESTNET
                && block.chainid != LOCAL_ANVIL
        ) {
            revert Errors.WrongChain(block.chainid);
        }
    }
}
