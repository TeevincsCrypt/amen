// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AmenOracle} from "../src/AmenOracle.sol";
import {IAmenOracle} from "../src/interfaces/IAmenOracle.sol";

/// @notice Records the official close for NVDA once cash has closed (permissionless path).
///         Pass ROUND_ID to use `recordSessionCloseAtRound` if the feed already ticked after the bell.
/// forge script script/RecordClose.s.sol --rpc-url robinhood --broadcast
contract RecordClose is Script {
    function run() external {
        string memory dep = vm.readFile(
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json")
        );
        AmenOracle oracle = AmenOracle(vm.parseJsonAddress(dep, ".oracle"));
        address nvda = vm.parseJsonAddress(dep, ".nvda");
        uint256 roundId = vm.envOr("ROUND_ID", uint256(0));

        (uint256 sessionId, uint256 closeTs) = oracle.lastCloseAt(block.timestamp);
        console2.log("session", sessionId, "closeTs", closeTs);

        vm.startBroadcast();
        if (roundId == 0) oracle.recordSessionClose(nvda);
        else oracle.recordSessionCloseAtRound(nvda, uint80(roundId));
        vm.stopBroadcast();

        IAmenOracle.Mark memory m = oracle.officialClose(nvda, sessionId);
        console2.log("recorded close priceUsd (1e18)", m.priceUsd, "updatedAt", m.updatedAt);
    }
}
