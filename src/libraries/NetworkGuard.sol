// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Errors} from "./Errors.sol";

/// @title NetworkGuard
/// @notice Amen is built for Robinhood Chain only: its session and oracle assumptions are
///         specific to official Robinhood Stock Tokens and their Chainlink feeds.
///         Deployment reverts anywhere else. Local demos run anvil with `--chain-id 46630` or fork 4663.
abstract contract NetworkGuard {
    uint256 internal constant ROBINHOOD_MAINNET = 4663;
    uint256 internal constant ROBINHOOD_TESTNET = 46630;

    constructor() {
        _requireRobinhood();
    }

    function _requireRobinhood() internal view {
        if (block.chainid != ROBINHOOD_MAINNET && block.chainid != ROBINHOOD_TESTNET) {
            revert Errors.WrongChain(block.chainid);
        }
    }
}
